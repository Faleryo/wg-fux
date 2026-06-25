export const CONTAINER_COLORS = ['indigo', 'emerald', 'rose', 'amber', 'cyan', 'purple'];

export const getContainerColor = (name) => {
  const hash = (s) =>
    s.split('').reduce((a, b) => {
      a = (a << 5) - a + b.charCodeAt(0);
      return a & a;
    }, 0);
  return CONTAINER_COLORS[Math.abs(hash(name || '')) % CONTAINER_COLORS.length];
};

export const isOnlineClient = (client) => client.isOnline === true;
export const isExpired = (expiry) => expiry && new Date(expiry) < new Date();
export const isExpiringSoon = (expiry) => {
  if (!expiry || isExpired(expiry)) return false;
  return (new Date(expiry) - new Date()) / (1000 * 60 * 60 * 24) <= 7;
};
