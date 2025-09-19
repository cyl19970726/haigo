export const OCTA_PER_APT = 100_000_000;
export const calculatePricing = ({ amountApt, insuranceRateBps, platformFeeBps }) => {
    const amountSubunits = Math.max(Math.round(amountApt * OCTA_PER_APT), 0);
    const insuranceFeeSubunits = Math.max(Math.round((amountSubunits * insuranceRateBps) / 10_000), 0);
    const platformFeeSubunits = Math.max(Math.round((amountSubunits * platformFeeBps) / 10_000), 0);
    const totalSubunits = amountSubunits + insuranceFeeSubunits + platformFeeSubunits;
    return {
        amountSubunits,
        insuranceFeeSubunits,
        platformFeeSubunits,
        totalSubunits,
        currency: 'APT',
        precision: OCTA_PER_APT
    };
};
export const formatSubunitsToApt = (value, precision = OCTA_PER_APT) => {
    return value / precision;
};
export const deriveRecordUid = (orderId, transactionHash) => {
    if (transactionHash) {
        return `order-${orderId}-${transactionHash.slice(2, 10)}`;
    }
    return `order-${orderId}`;
};
