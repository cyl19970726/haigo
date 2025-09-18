import { OrderCheckInView } from '../../../../../features/orders/inbound/OrderCheckInView';

interface CheckInPageProps {
  params: {
    recordUid: string;
  };
}

export default function OrderCheckInPage({ params }: CheckInPageProps) {
  return <OrderCheckInView recordUid={params.recordUid} />;
}
