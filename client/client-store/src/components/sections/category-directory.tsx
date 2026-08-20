import Image from 'next/image';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Category } from '@/types';
import { cn, pluralise } from '@/lib/utils';

/**
 * Every department, with the aisles inside it, on the homepage itself.
 *
 * The category rail at the top of the page answers "which departments does this
 * shop have" and stops there: a subcategory is reachable only by opening its
 * parent first, and a visitor who wants headphones has to guess that they live
 * under Electronics before the shop will admit it has any. On a broad catalogue
 * that guess is where people leave.
 *
 * So this block prints the tree. Each department is a panel carrying its own
 * picture, its subtree count and a link to itself; every child under it is a
 * link of its own, so the second click lands on the aisle rather than on the
 * department. Nothing is truncated — the point of the block is that it is the
 * whole list, and a "+4 more" would put the reader back where the rail left
 * them.
 *
 * `Category.children` is the tree the API already sends, so this costs no extra
 * call however deep it goes. Depth is capped at grandchildren all the same: a
 * fourth level indents a homepage panel into a file explorer, and a shop that
 * nests that far has a navigation problem this block cannot fix.
 */
const MAX_DEPTH = 2;

export function CategoryDirectory({
  categories,
  className,
}: {
  categories: Category[];
  className?: string;
}) {
  if (categories.length === 0) return null;

  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {categories.map((category) => (
        <li
          key={category.id}
          className="flex flex-col rounded-(--radius-card) border border-border bg-surface p-4"
        >
          <div className="flex items-center gap-3">
            {/*
              Decorative, and deliberately not a second link: the heading beside
              it goes to the same place, and two adjacent links with the same
              destination read as two entries to anyone using a screen reader.
            */}
            <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-(--radius-card) bg-surface-alt text-base font-semibold text-subtle">
              {category.imageUrl ? (
                <Image
                  src={category.imageUrl}
                  alt=""
                  aria-hidden
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                category.name.charAt(0)
              )}
            </span>

            <div className="min-w-0">
              <Link
                href={`/category/${category.slug}`}
                className="group flex items-center gap-1 font-semibold leading-tight hover:text-primary"
              >
                <span className="truncate">{category.name}</span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <p className="mt-0.5 text-xs text-muted">
                {category.productCount} {pluralise(category.productCount, 'product')}
              </p>
            </div>
          </div>

          <SubcategoryList categories={category.children} depth={1} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The links under a department.
 *
 * Wrapped rather than stacked, because a department with nine aisles would
 * otherwise make its panel three times the height of the one beside it and
 * leave the grid full of holes.
 */
function SubcategoryList({ categories, depth }: { categories: Category[]; depth: number }) {
  if (categories.length === 0 || depth > MAX_DEPTH) return null;

  return (
    <ul
      className={cn(
        'flex flex-wrap gap-x-3 gap-y-1',
        depth === 1 ? 'mt-3 border-t border-border pt-3 text-sm' : 'mt-1 w-full pl-3 text-xs',
      )}
    >
      {categories.map((category) => (
        <li key={category.id}>
          <Link
            href={`/category/${category.slug}`}
            className={cn(
              'hover:text-primary hover:underline',
              depth === 1 ? 'text-muted' : 'text-subtle',
            )}
          >
            {category.name}
          </Link>
          <SubcategoryList categories={category.children} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}
