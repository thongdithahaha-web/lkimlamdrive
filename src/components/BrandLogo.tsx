import React from 'react';

interface BrandLogoProps {
  brandName?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  brandName = 'LKIMLAMDRIVE',
  size = 'md',
  showText = true,
  className = '',
}) => {
  const iconSizes = {
    sm: 'h-6 w-auto',
    md: 'h-8 w-auto',
    lg: 'h-10 w-auto',
  };

  const textSizes = {
    sm: 'text-base',
    md: 'text-lg',
    lg: 'text-2xl',
  };

  return (
    <div className={`inline-flex items-center gap-2.5 select-none whitespace-nowrap shrink-0 ${className}`}>
      <img
        src="/mini-logo.svg"
        alt={`${brandName} Logo`}
        className={`${iconSizes[size]} object-contain drop-shadow-[0_2px_10px_rgba(93,69,245,0.45)]`}
      />
      {showText && (
        <span
          className={`${textSizes[size]} font-extrabold tracking-wider text-[#6A52FF] uppercase drop-shadow-[0_2px_12px_rgba(93,69,245,0.35)]`}
        >
          {brandName}
        </span>
      )}
    </div>
  );
};
