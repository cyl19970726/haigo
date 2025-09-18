export interface LogisticsInfoInput {
  carrier?: string;
  trackingNumber?: string;
  notes?: string;
}

export const deriveInboundLogistics = ({ carrier, trackingNumber }: LogisticsInfoInput): string | null => {
  const carrierLabel = carrier?.trim();
  const tracking = trackingNumber?.trim();
  if (!carrierLabel && !tracking) return null;
  if (!carrierLabel) return tracking ?? null;
  if (!tracking) return carrierLabel;
  return `${carrierLabel}#${tracking}`;
};
