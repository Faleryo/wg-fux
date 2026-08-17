#!/usr/bin/env python3
"""Banc de mesure de la latence sous charge, pour chiffrer l'effet réel de la QoS.

POURQUOI CET OUTIL
──────────────────
`ping` ne répond pas à la question. Deux raisons, constatées sur cette
plateforme (cf. commentaire de wg-apply-qos.sh) :

  1. L'ICMP est déprioritisé par les routeurs et les modems mobiles. Mesuré ici :
     min 142 ms / moyenne 263 ms / pointes 742 ms en ICMP, alors que les joueurs
     tournent à ~50 ms réels. Un ping ne mesure pas la latence de transport.
  2. Surtout : la latence À VIDE ne dit RIEN sur le bufferbloat. Un lien peut
     afficher 30 ms au repos et 800 ms dès qu'un téléchargement démarre. C'est
     exactement ce que CAKE corrige, et c'est invisible pour `ping` lancé seul.

Ce banc mesure donc ce qui compte : la latence d'un flux de type jeu (petits
paquets UDP à cadence fixe) MESURÉE PENDANT que le lien est saturé, comparée à
la même mesure à vide. L'écart entre les deux est la métrique du bufferbloat.

MODÈLE
──────
  serveur (sur le VPS)  : écho UDP + puits/source TCP
  client  (derrière le VPN) : sonde UDP à cadence fixe + charge TCP concurrente

Le RTT est calculé sur l'horodatage RENVOYÉ dans le paquet : aucune
synchronisation d'horloge n'est nécessaire entre les deux machines.

La charge est du TCP, pas un flood UDP : c'est autolimité par le contrôle de
congestion, ça ne peut pas noyer un tiers, et ça reproduit le cas réel (un
téléchargement qui remplit la file pendant qu'on joue).

USAGE
─────
  # sur le VPS
  ./wg-latency-bench.py serveur

  # sur une machine connectée au VPN
  ./wg-latency-bench.py client --hote 10.66.66.1 --label "apres-besteffort"

  # comparer deux runs
  ./wg-latency-bench.py client --hote 10.66.66.1 --json > apres.json

Aucune dépendance : bibliothèque standard uniquement.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import socket
import struct
import sys
import threading
import time

PORT_DEFAUT = 51999
EN_TETE = struct.Struct("!Qq")  # seq (u64) + horodatage monotone client (ns, i64)
TAILLE_MIN = EN_TETE.size

# Garde-fous : cet outil génère du trafic. On borne ce qu'il peut faire pour
# qu'une faute de frappe ne se transforme pas en inondation.
RATE_MAX = 1000  # paquets/s
DUREE_MAX = 600  # secondes par phase
FLUX_MAX = 16  # connexions TCP de charge


# ─────────────────────────────────────────────────────────────────────────────
# Côté serveur
# ─────────────────────────────────────────────────────────────────────────────


def _socket_ecoute(port: int, tcp: bool) -> socket.socket:
    """Crée une socket d'écoute, double pile IPv4/IPv6 quand le noyau le permet."""
    type_ = socket.SOCK_STREAM if tcp else socket.SOCK_DGRAM
    try:
        s = socket.socket(socket.AF_INET6, type_)
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        adresse = ("::", port)
    except OSError:
        s = socket.socket(socket.AF_INET, type_)
        adresse = ("0.0.0.0", port)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(adresse)
    return s


def _echo_udp(port: int) -> None:
    """Renvoie chaque datagramme tel quel. Le client y lit son propre horodatage."""
    s = _socket_ecoute(port, tcp=False)
    while True:
        try:
            data, pair = s.recvfrom(4096)
            s.sendto(data, pair)
        except OSError:
            continue


def _sert_charge(conn: socket.socket) -> None:
    """Une connexion de charge. Le client annonce le sens dans les 4 premiers octets."""
    with conn:
        try:
            conn.settimeout(120)
            sens = conn.recv(4)
            bloc = os.urandom(65536)
            if sens.startswith(b"DOWN"):
                # Le serveur émet : sature le sens VPS → client, c'est-à-dire
                # l'egress de wg0, précisément là où CAKE est appliqué.
                while True:
                    conn.sendall(bloc)
            else:
                while conn.recv(262144):
                    pass
        except (OSError, socket.timeout):
            pass


def _puits_tcp(port: int) -> None:
    s = _socket_ecoute(port, tcp=True)
    s.listen(FLUX_MAX * 2)
    while True:
        try:
            conn, _ = s.accept()
        except OSError:
            continue
        threading.Thread(target=_sert_charge, args=(conn,), daemon=True).start()


def mode_serveur(port: int) -> int:
    threading.Thread(target=_echo_udp, args=(port,), daemon=True).start()
    print(f"Banc prêt — écho UDP et puits TCP sur le port {port}. Ctrl-C pour arrêter.")
    try:
        _puits_tcp(port)
    except KeyboardInterrupt:
        print("\nArrêt.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Statistiques
# ─────────────────────────────────────────────────────────────────────────────


def _centile(tries: list[float], p: float) -> float:
    if not tries:
        return math.nan
    k = (len(tries) - 1) * p / 100.0
    bas, haut = math.floor(k), math.ceil(k)
    if bas == haut:
        return tries[int(k)]
    return tries[bas] * (haut - k) + tries[haut] * (k - bas)


def _resume(rtts_ms: list[float], envoyes: int) -> dict:
    """Centiles plutôt que moyenne : c'est la queue de distribution qui se voit en jeu.

    `rtts_ms` doit être dans l'ORDRE D'ARRIVÉE : la variation se calcule dessus,
    pas sur la liste triée — sur des valeurs triées elle serait nulle par
    construction, ce qui donnait un « var 0.0 » trompeur même en plein
    bufferbloat.
    """
    recus = len(rtts_ms)
    # « Jitter » ici = variation moyenne entre RTT consécutifs. Ce n'est pas le
    # jitter RFC 3550 (qui suppose un sens unique et des horloges alignées) ;
    # on le nomme donc pour ce qu'il est, sans surinterpréter.
    if recus > 1:
        variation = sum(
            abs(rtts_ms[i] - rtts_ms[i - 1]) for i in range(1, recus)
        ) / (recus - 1)
    else:
        variation = math.nan
    tries = sorted(rtts_ms)
    return {
        "envoyes": envoyes,
        "recus": recus,
        "perte_pct": (100.0 * (envoyes - recus) / envoyes) if envoyes else math.nan,
        "p50": _centile(tries, 50),
        "p90": _centile(tries, 90),
        "p99": _centile(tries, 99),
        "max": tries[-1] if tries else math.nan,
        "variation_moy": variation,
    }


def _verdict(delta_ms: float) -> str:
    """Barème calé sur l'échelle bufferbloat usuelle (A+ ≈ <5 ms … F ≈ >200 ms).

    Un premier jet plaçait le seuil « correct » à 100 ms. Confronté au banc de
    validation, il qualifiait de « correct » un goulot FIFO qui ajoutait 89 ms —
    injouable. Les seuils viennent donc de l'échelle publique, pas d'une
    intuition.
    """
    if math.isnan(delta_ms):
        return "mesure incomplète"
    if delta_ms < 5:
        return "excellent — l'AQM tient la file"
    if delta_ms < 30:
        return "bon — sans effet perceptible en jeu"
    if delta_ms < 100:
        return "MOYEN — perceptible en jeu compétitif, la file grossit sous charge"
    if delta_ms < 200:
        return "MAUVAIS — bufferbloat net, l'AQM ne contrôle pas ce goulot"
    return "SÉVÈRE — le goulot est ailleurs que sous notre contrôle, ou l'AQM est inactif"


# ─────────────────────────────────────────────────────────────────────────────
# Côté client
# ─────────────────────────────────────────────────────────────────────────────


class Charge:
    """Charge TCP concurrente. Démarrage et arrêt explicites, jamais implicites."""

    def __init__(self, cible: tuple, famille: int, flux: int, sens: str):
        self.cible, self.famille, self.flux, self.sens = cible, famille, flux, sens
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self.octets = 0
        self._verrou = threading.Lock()

    def _un_flux(self) -> None:
        try:
            c = socket.socket(self.famille, socket.SOCK_STREAM)
            c.settimeout(10)
            c.connect(self.cible)
            c.sendall(b"DOWN" if self.sens == "down" else b"UP\x00\x00")
            c.settimeout(5)
            bloc = os.urandom(65536)
            while not self._stop.is_set():
                if self.sens == "down":
                    n = len(c.recv(262144))
                    if n == 0:
                        break
                else:
                    c.sendall(bloc)
                    n = len(bloc)
                with self._verrou:
                    self.octets += n
        except (OSError, socket.timeout):
            pass
        finally:
            try:
                c.close()
            except Exception:
                pass

    def demarrer(self) -> None:
        for _ in range(self.flux):
            t = threading.Thread(target=self._un_flux, daemon=True)
            t.start()
            self._threads.append(t)

    def arreter(self) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=2)


def _phase_sonde(
    sock: socket.socket, cible: tuple, duree: float, rate: int, taille: int
) -> tuple[list[float], int]:
    """Émet une sonde à cadence fixe et collecte les échos. Retourne (rtts_ms, envoyés)."""
    rtts: list[float] = []
    verrou = threading.Lock()
    fini = threading.Event()

    def recepteur() -> None:
        sock.settimeout(0.2)
        while not fini.is_set():
            try:
                data, _ = sock.recvfrom(4096)
            except (socket.timeout, OSError):
                continue
            if len(data) < TAILLE_MIN:
                continue
            _, t_envoi = EN_TETE.unpack_from(data)
            rtt = (time.monotonic_ns() - t_envoi) / 1e6
            with verrou:
                rtts.append(rtt)

    th = threading.Thread(target=recepteur, daemon=True)
    th.start()

    bourrage = b"\x00" * max(0, taille - TAILLE_MIN)
    intervalle = 1.0 / rate
    debut = time.monotonic()
    prochain = debut
    seq = 0
    while time.monotonic() - debut < duree:
        try:
            sock.sendto(EN_TETE.pack(seq, time.monotonic_ns()) + bourrage, cible)
            seq += 1
        except OSError:
            pass
        prochain += intervalle
        retard = prochain - time.monotonic()
        if retard > 0:
            time.sleep(retard)
        else:
            prochain = time.monotonic()  # on a pris du retard, on ne rattrape pas en rafale

    # Fenêtre de grâce : les derniers échos sont encore en vol.
    time.sleep(1.0)
    fini.set()
    th.join(timeout=2)
    with verrou:
        return list(rtts), seq


def mode_client(a: argparse.Namespace) -> int:
    infos = socket.getaddrinfo(a.hote, a.port, proto=socket.IPPROTO_UDP)
    famille, _, _, _, cible = infos[0]

    sock = socket.socket(famille, socket.SOCK_DGRAM)
    sock.settimeout(2)

    # Aller-retour de contrôle avant de mesurer quoi que ce soit : sans ça, un
    # serveur injoignable produit un rapport « 100 % de perte » au lieu d'une
    # erreur claire.
    sock.sendto(EN_TETE.pack(0, time.monotonic_ns()), cible)
    try:
        sock.recvfrom(4096)
    except (socket.timeout, OSError):
        print(
            f"Erreur : aucune réponse de {a.hote}:{a.port}.\n"
            f"Lancez d'abord « {sys.argv[0]} serveur » sur l'hôte distant, et vérifiez\n"
            f"que le port {a.port} UDP et TCP est joignable à travers le tunnel.",
            file=sys.stderr,
        )
        return 2

    # La progression va sur stderr : sans ça, `--json` produisait un stdout
    # mélangé, illisible par `json.load` — constaté à l'exécution.
    def etape(msg: str) -> None:
        print(msg, file=sys.stderr, flush=True)

    etape(f"Cible {a.hote}:{a.port} — sonde {a.rate} pkt/s de {a.taille} o")
    etape(f"Phase 1/2 : à vide ({a.duree} s)…")
    rtt_vide, envoyes_vide = _phase_sonde(sock, cible, a.duree, a.rate, a.taille)

    etape(f"Phase 2/2 : sous charge — {a.flux} flux TCP « {a.sens} » ({a.duree} s)…")
    infos_tcp = socket.getaddrinfo(a.hote, a.port, proto=socket.IPPROTO_TCP)
    charge = Charge(infos_tcp[0][4], infos_tcp[0][0], a.flux, a.sens)
    charge.demarrer()
    time.sleep(a.montee)  # laisse la charge atteindre son régime avant de mesurer
    t0 = time.monotonic()
    rtt_charge, envoyes_charge = _phase_sonde(sock, cible, a.duree, a.rate, a.taille)
    ecoule = time.monotonic() - t0
    charge.arreter()
    debit = (charge.octets * 8 / ecoule / 1e6) if ecoule > 0 else math.nan

    vide = _resume(rtt_vide, envoyes_vide)
    sous_charge = _resume(rtt_charge, envoyes_charge)
    rapport = {
        "label": a.label,
        "hote": a.hote,
        "rate_pps": a.rate,
        "taille_octets": a.taille,
        "duree_s": a.duree,
        "charge": {"flux": a.flux, "sens": a.sens, "debit_mbit_s": debit},
        "a_vide": vide,
        "sous_charge": sous_charge,
        "bufferbloat_p99_ms": sous_charge["p99"] - vide["p99"],
    }

    if a.json:
        print(json.dumps(rapport, indent=2, allow_nan=True))
        return 0

    def ligne(nom: str, r: dict) -> str:
        return (
            f"  {nom:<12} p50 {r['p50']:7.1f}  p90 {r['p90']:7.1f}  p99 {r['p99']:7.1f}  "
            f"max {r['max']:7.1f}  var {r['variation_moy']:6.1f}  perte {r['perte_pct']:5.1f} %"
        )

    print()
    if a.label:
        print(f"=== {a.label} ===")
    print(f"Latence aller-retour, en millisecondes ({vide['recus']}/{sous_charge['recus']} échos)")
    print(ligne("à vide", vide))
    print(ligne("sous charge", sous_charge))
    print()
    print(f"  Charge appliquée : {debit:.0f} Mbit/s sur {a.flux} flux TCP ({a.sens})")
    delta = rapport["bufferbloat_p99_ms"]
    print(f"  ► Latence ajoutée par la charge (p99) : {delta:+.1f} ms")
    print(f"    {_verdict(delta)}")
    print()
    print("  Rappel : c'est ce delta, pas la latence à vide, que la QoS fait bouger.")
    print("  Relancez avec --label avant/après un changement pour comparer honnêtement.")
    return 0


# ─────────────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Mesure la latence d'un flux de type jeu, à vide puis sous charge.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Le serveur tourne sur le VPS, le client sur une machine derrière le VPN.",
    )
    sous = p.add_subparsers(dest="mode", required=True)

    ps = sous.add_parser("serveur", help="écho UDP + puits TCP (à lancer sur le VPS)")
    ps.add_argument("--port", type=int, default=PORT_DEFAUT)

    pc = sous.add_parser("client", help="mesure (à lancer derrière le VPN)")
    pc.add_argument("--hote", required=True, help="adresse du serveur, vue depuis le tunnel")
    pc.add_argument("--port", type=int, default=PORT_DEFAUT)
    pc.add_argument("--duree", type=int, default=20, help="durée de chaque phase, en s (défaut 20)")
    pc.add_argument(
        "--rate", type=int, default=60, help="paquets/s de la sonde (défaut 60, cadence type FPS)"
    )
    pc.add_argument(
        "--taille", type=int, default=120, help="octets par sonde (défaut 120, taille type jeu)"
    )
    pc.add_argument("--flux", type=int, default=4, help="connexions TCP de charge (défaut 4)")
    pc.add_argument(
        "--sens",
        choices=("down", "up"),
        default="down",
        help="sens de la charge. « down » (défaut) sature l'egress de wg0, là où CAKE agit.",
    )
    pc.add_argument("--montee", type=float, default=3.0, help="délai de montée en charge, en s")
    pc.add_argument("--label", default="", help="étiquette du run, pour comparer deux mesures")
    pc.add_argument("--json", action="store_true", help="sortie machine")

    a = p.parse_args(argv)

    if a.mode == "serveur":
        return mode_serveur(a.port)

    if not 1 <= a.rate <= RATE_MAX:
        p.error(f"--rate doit être entre 1 et {RATE_MAX}")
    if not 1 <= a.duree <= DUREE_MAX:
        p.error(f"--duree doit être entre 1 et {DUREE_MAX}")
    if not 0 <= a.flux <= FLUX_MAX:
        p.error(f"--flux doit être entre 0 et {FLUX_MAX}")
    if not TAILLE_MIN <= a.taille <= 1400:
        p.error(f"--taille doit être entre {TAILLE_MIN} et 1400")
    return mode_client(a)


if __name__ == "__main__":
    sys.exit(main())
