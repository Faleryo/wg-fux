import React from 'react';
import { cn } from '../../lib/utils';

// ─── Base Skeleton ────────────────────────────────────────────────────────────
export const Skeleton = ({ className, style, ...props }) => (
  <div
    className={cn("animate-shimmer rounded-2xl bg-white/[0.06]", className)}
    style={style}
    {...props}
  />
);

// ─── Dashboard Skeleton ───────────────────────────────────────────────────────
export const SkeletonDashboard = () => (
  <div className="space-y-6 animate-in fade-in duration-500">
    {/* Row 1 */}
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      <div className="xl:col-span-8">
        <div className="bg-slate-900/40 border border-white/5 rounded-[2.5rem] p-8 space-y-8 min-h-[320px]">
          <div className="flex justify-between items-start flex-wrap gap-4">
            <div className="space-y-3">
              <Skeleton className="h-10 w-56" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        </div>
      </div>
      <div className="xl:col-span-4 flex flex-col gap-6">
        <Skeleton className="h-28 rounded-[2.5rem]" />
        <Skeleton className="h-48 rounded-[2.5rem]" />
        <Skeleton className="h-24 rounded-[2.5rem]" />
      </div>
    </div>
    {/* Row 2 */}
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2">
        <Skeleton className="h-64 rounded-[2.5rem]" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-[7.5rem] rounded-[2.5rem]" />
        <Skeleton className="h-[7.5rem] rounded-[2.5rem]" />
      </div>
    </div>
  </div>
);

// ─── Card Skeleton ────────────────────────────────────────────────────────────
export const SkeletonCard = ({ count = 6 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 animate-in fade-in duration-500">
    {[...Array(count)].map((_, i) => (
      <div key={i} className="bg-slate-900/40 border border-white/5 rounded-[2.5rem] p-8 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="w-12 h-12 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="w-8 h-8 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-4 w-16" />
          <div className="flex gap-2">
            <Skeleton className="w-8 h-8 rounded-xl" />
            <Skeleton className="w-8 h-8 rounded-xl" />
            <Skeleton className="w-8 h-8 rounded-xl" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// ─── Table Skeleton ───────────────────────────────────────────────────────────
export const SkeletonTable = ({ rows = 8 }) => (
  <div className="bg-slate-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden animate-in fade-in duration-500">
    <div className="p-6 border-b border-white/5">
      <div className="flex gap-4">
        <Skeleton className="h-10 w-64 rounded-2xl" />
        <Skeleton className="h-10 w-36 rounded-2xl" />
      </div>
    </div>
    <div className="divide-y divide-white/5">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex items-center gap-6 px-8 py-5" style={{ opacity: 1 - i * 0.08 }}>
          <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24 ml-4" />
          <div className="flex-1" />
          <Skeleton className="h-6 w-20 rounded-xl" />
          <Skeleton className="h-6 w-16 rounded-xl" />
        </div>
      ))}
    </div>
  </div>
);

export default Skeleton;
