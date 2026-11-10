import React from 'react';

/**
 * Renders the signature diagonal 3D metallic dark ribbons with subtle noise dithering
 * identical to ezdrive.id.vn's hero backdrop, without heavy WebGL CPU overhead.
 */
export const DiagonalRibbonsBackground: React.FC = () => {
  const ribbons = [
    { left: '-25%', width: '16%', opacity: 0.75, delay: '0s' },
    { left: '-8%', width: '14%', opacity: 0.45, delay: '1.5s' },
    { left: '6%', width: '19%', opacity: 0.9, delay: '0.8s' },
    { left: '25%', width: '15%', opacity: 0.55, delay: '2.2s' },
    { left: '41%', width: '21%', opacity: 0.85, delay: '0.4s' },
    { left: '62%', width: '15%', opacity: 0.5, delay: '1.9s' },
    { left: '77%', width: '19%', opacity: 0.75, delay: '1.1s' },
    { left: '96%', width: '17%', opacity: 0.55, delay: '2.7s' },
  ];

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-black pointer-events-none select-none">
      {/* Rotated 3D metallic ribbon planes */}
      <div
        className="absolute -inset-[45%] flex items-stretch"
        style={{
          transform: 'rotate(-42deg)',
          transformOrigin: 'center center',
        }}
      >
        {ribbons.map((r, idx) => (
          <div
            key={idx}
            style={{
              left: r.left,
              width: r.width,
              opacity: r.opacity,
              animationDelay: r.delay,
              background:
                'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(56,56,64,0.68) 28%, rgba(130,130,145,0.34) 48%, rgba(28,28,34,0.92) 84%, rgba(0,0,0,1) 100%)',
              boxShadow: 'inset 1px 0 0 rgba(255,255,255,0.12), -16px 0 36px rgba(0,0,0,0.95)',
            }}
            className="absolute top-0 bottom-0 transition-opacity duration-1000"
          />
        ))}
      </div>

      {/* Specular top-left & center studio light wash */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 18% 18%, rgba(255,255,255,0.09) 0%, transparent 42%), radial-gradient(circle at 60% 42%, rgba(255,255,255,0.06) 0%, transparent 48%)',
        }}
      />

      {/* Film grain / noise dithering identical to shader fragment */}
      <div
        className="absolute inset-0 opacity-[0.045] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundSize: '180px 180px',
        }}
      />

      {/* Measured dark vignette scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/40" />
    </div>
  );
};
