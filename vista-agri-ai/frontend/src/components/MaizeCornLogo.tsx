import React from 'react';

interface MaizeCornLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export const MaizeCornLogo: React.FC<MaizeCornLogoProps> = ({ size = 'md', showText = true }) => {
  const dimMap = {
    sm: { icon: 'w-9 h-9', title: 'text-base', sub: 'text-[9px]' },
    md: { icon: 'w-12 h-12', title: 'text-xl', sub: 'text-[10px]' },
    lg: { icon: 'w-16 h-16', title: 'text-2xl', sub: 'text-xs' },
  };

  const { icon, title, sub } = dimMap[size];

  return (
    <div className="flex items-center gap-3.5 select-none">
      {/* Luxury Golden-Green Maize Corn Emblem with Crisp White Background */}
      <div className={`relative ${icon} flex items-center justify-center rounded-2xl bg-white border-2 border-emerald-400 shadow-xl shadow-emerald-950/30 p-1.5 transition-transform hover:scale-105`}>
        {/* Subtle Ambient Glow */}
        <div className="absolute inset-0 rounded-2xl bg-emerald-400/10 pointer-events-none" />

        <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-md">
          <defs>
            {/* Golden Maize Corn Gradient */}
            <linearGradient id="maizeGold" x1="20" y1="20" x2="80" y2="80" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#FDE047" />
              <stop offset="40%" stopColor="#EAB308" />
              <stop offset="100%" stopColor="#CA8A04" />
            </linearGradient>

            {/* Lush Agricultural Emerald Leaf Gradient */}
            <linearGradient id="emeraldLeaf" x1="10" y1="90" x2="60" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#064E3B" />
              <stop offset="50%" stopColor="#059669" />
              <stop offset="100%" stopColor="#34D399" />
            </linearGradient>

            {/* Right Leaf Gradient */}
            <linearGradient id="emeraldLeafRight" x1="90" y1="90" x2="40" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#022C22" />
              <stop offset="60%" stopColor="#10B981" />
              <stop offset="100%" stopColor="#6EE7B7" />
            </linearGradient>
          </defs>

          {/* Luxury Halo Ring */}
          <circle cx="50" cy="50" r="46" stroke="#34D399" strokeWidth="1.5" strokeOpacity="0.4" strokeDasharray="3 3" />

          {/* Left Protective Maize Husk Leaf */}
          <path
            d="M 28 85 C 18 65 22 40 46 22 C 34 38 32 66 44 86 C 36 86 31 86 28 85 Z"
            fill="url(#emeraldLeaf)"
          />

          {/* Right Protective Maize Husk Leaf */}
          <path
            d="M 72 85 C 82 65 78 40 54 22 C 66 38 68 66 56 86 C 64 86 69 86 72 85 Z"
            fill="url(#emeraldLeafRight)"
          />

          {/* Maize Corn Cob Body */}
          <ellipse cx="50" cy="50" rx="15" ry="26" fill="url(#maizeGold)" />

          {/* Detailed Golden Geometric Corn Kernels */}
          {/* Row 1 */}
          <ellipse cx="50" cy="32" rx="3.5" ry="2.2" fill="#FEF08A" opacity="0.95" />
          <ellipse cx="44" cy="34" rx="2.5" ry="2" fill="#EAB308" />
          <ellipse cx="56" cy="34" rx="2.5" ry="2" fill="#EAB308" />

          {/* Row 2 */}
          <ellipse cx="50" cy="39" rx="4" ry="2.5" fill="#FEF08A" />
          <ellipse cx="42" cy="41" rx="3" ry="2.2" fill="#EAB308" />
          <ellipse cx="58" cy="41" rx="3" ry="2.2" fill="#EAB308" />

          {/* Row 3 - Center */}
          <ellipse cx="50" cy="47" rx="4.5" ry="2.8" fill="#FEF08A" />
          <ellipse cx="41" cy="49" rx="3.2" ry="2.4" fill="#EAB308" />
          <ellipse cx="59" cy="49" rx="3.2" ry="2.4" fill="#EAB308" />

          {/* Row 4 */}
          <ellipse cx="50" cy="55" rx="4.2" ry="2.6" fill="#FEF08A" />
          <ellipse cx="42" cy="57" rx="3" ry="2.3" fill="#EAB308" />
          <ellipse cx="58" cy="57" rx="3" ry="2.3" fill="#EAB308" />

          {/* Row 5 */}
          <ellipse cx="50" cy="63" rx="3.8" ry="2.4" fill="#FEF08A" />
          <ellipse cx="43" cy="65" rx="2.8" ry="2.1" fill="#EAB308" />
          <ellipse cx="57" cy="65" rx="2.8" ry="2.1" fill="#EAB308" />

          {/* Row 6 - Tip */}
          <ellipse cx="50" cy="70" rx="3" ry="2" fill="#FDE047" />

          {/* Corn Silk Hair at Top */}
          <path d="M 47 24 Q 45 14 42 10" stroke="#FDE047" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M 50 22 Q 50 12 52 8" stroke="#FEF08A" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M 53 24 Q 56 15 58 11" stroke="#FDE047" strokeWidth="1.2" strokeLinecap="round" />

          {/* Base Stem */}
          <path d="M 47 76 C 47 88 53 88 53 76 Z" fill="#047857" />
        </svg>
      </div>

      {/* Luxury Brand Typography */}
      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className={`${title} font-black tracking-tight text-white flex items-center`}>
              VISTA <span className="text-emerald-400 ml-1.5">AGRI AI</span>
            </span>
            <span className="text-[9px] uppercase tracking-wider font-extrabold bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full shadow-sm">
              LUXURY AGRI
            </span>
          </div>
          <span className={`${sub} text-emerald-200/90 font-medium tracking-wide mt-0.5`}>
            SEE • TRACK • PROTECT • UNDERSTAND • ACT
          </span>
        </div>
      )}
    </div>
  );
};
