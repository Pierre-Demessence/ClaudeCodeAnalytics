import { OctagonX } from 'lucide-react';

/** A rate limit stopped the work. The octagon differs from the cap's triangle by shape, not only by place. */
export const BlockedIcon = ({ size = 14 }: { size?: number }) => <OctagonX aria-hidden="true" className="icon-inline icon-blocked icon-critical" size={size} />;
