import { MOCK_PRODUCTS } from '@/lib/api/mock/fixtures/products';
import { MOCK_CATEGORIES, ALL_CATEGORIES } from '@/lib/api/mock/fixtures/categories';
import { MOCK_BRANDS } from '@/lib/api/mock/fixtures/brands';
import { MOCK_HOMEPAGE_SECTIONS } from '@/lib/api/mock/fixtures/homepage';

console.log('products:', MOCK_PRODUCTS.length);
console.log('categories:', MOCK_CATEGORIES.length, 'top,', ALL_CATEGORIES.length, 'total');
console.log('brands:', MOCK_BRANDS.length);
console.log('sections:', MOCK_HOMEPAGE_SECTIONS.map((s) => s.type).join(', '));
console.log('on sale:', MOCK_PRODUCTS.filter((p) => p.salePrice).length);
console.log('new:', MOCK_PRODUCTS.filter((p) => p.isNewArrival).length, 'best:', MOCK_PRODUCTS.filter((p) => p.isBestSeller).length, 'oos:', MOCK_PRODUCTS.filter((p) => !p.inStock).length);
const dup = MOCK_PRODUCTS.map((p) => p.slug).filter((s, i, a) => a.indexOf(s) !== i);
console.log('duplicate slugs:', dup.length ? dup.join(',') : 'none');
