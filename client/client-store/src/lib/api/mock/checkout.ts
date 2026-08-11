import type { ShippingMethodOption } from '@/types';
import type { DeliveryTarget } from '../checkout';

/**
 * Mock shipping methods.
 *
 * Prices vary by whether the address is inside the capital, because that is the
 * shape a real rate table has here — and a checkout that quotes one flat rate
 * everywhere would not exercise the "recalculate when the address changes"
 * behaviour the UI needs to get right.
 */

const DHAKA = /dhaka|gulshan|banani|uttara|mirpur|dhanmondi/i;

export async function mockShippingMethods(target: DeliveryTarget): Promise<ShippingMethodOption[]> {
  const local = DHAKA.test(target.city ?? '');

  return [
    {
      id: 'standard',
      name: 'Standard delivery',
      description: local ? 'Delivered by our own riders' : 'Delivered by our courier partner',
      price: local ? '0.60' : '1.20',
      estimatedDaysMin: local ? 1 : 2,
      estimatedDaysMax: local ? 2 : 5,
    },
    {
      id: 'express',
      name: 'Express delivery',
      description: 'Next working day, ordered before 4pm',
      price: local ? '1.50' : '2.60',
      estimatedDaysMin: 1,
      estimatedDaysMax: local ? 1 : 2,
    },
  ];
}
