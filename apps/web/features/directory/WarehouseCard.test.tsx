import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WarehouseSummary } from '@shared/dto/orders';
import { WarehouseCard } from './WarehouseCard';

describe('WarehouseCard', () => {
  it('renders warehouse details and CTA', () => {
    const warehouse: WarehouseSummary = {
      id: '0x1',
      address: '0x1',
      name: 'Test Warehouse',
      stakingScore: 95,
      creditCapacity: 1500,
      availability: 'available',
      feePerUnit: 42,
      serviceAreas: ['north']
    };

    render(<WarehouseCard warehouse={warehouse} />);

    expect(screen.getByText('Test Warehouse')).toBeInTheDocument();
    expect(screen.getByText('Staking score')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Select warehouse/i })).toHaveAttribute(
      'href',
      '/orders/new?warehouse=0x1'
    );
  });
});
