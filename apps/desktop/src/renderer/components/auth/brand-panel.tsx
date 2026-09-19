import huntaraLogo from '../../assets/huntara-logo-horizontal.png';

interface BrandPanelProps {
  className?: string;
}

/**
 * Official HUNTARA horizontal logo lockup shown at the top of the authentication layout.
 */
export function BrandPanel({ className }: BrandPanelProps) {
  return (
    <div className={`flex items-center ${className ?? ''}`}>
      <img src={huntaraLogo} className="h-7 w-auto object-contain" alt="HUNTARA" />
    </div>
  );
}
