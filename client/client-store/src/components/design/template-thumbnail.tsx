import type { TemplateKey } from '@/templates/meta';
import { cn } from '@/lib/utils';

/**
 * A wireframe of each template's homepage, drawn in CSS.
 *
 * No image assets, for two reasons. A screenshot of a template goes stale the
 * moment the template changes and nobody notices, because nothing fails — the
 * picker just quietly advertises a layout that no longer exists. And a wireframe
 * shows the thing that actually differs between these six: where the hero sits,
 * whether there is a sidebar, how dense the grid is.
 *
 * Painted in the *current* theme's tokens, so the thumbnails also preview the
 * colour that is selected beside them.
 */

const Bar = ({ className }: { className?: string }) => (
  <span className={cn('block rounded-[1px] bg-current', className)} />
);

const Grid = ({ cols, rows = 1 }: { cols: number; rows?: number }) => (
  <span
    className="grid flex-1 gap-[2px]"
    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
  >
    {Array.from({ length: cols * rows }, (_, index) => (
      <span key={index} className="block rounded-[1px] bg-current opacity-35" />
    ))}
  </span>
);

function Frame({ children, dense }: { children: React.ReactNode; dense?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-full w-full flex-col overflow-hidden bg-surface p-1.5 text-foreground',
        dense ? 'gap-[3px]' : 'gap-[5px]',
      )}
    >
      {children}
    </span>
  );
}

const LAYOUTS: Record<TemplateKey, React.ReactElement> = {
  marketplace: (
    <Frame dense>
      <Bar className="h-[3px] w-full opacity-60" />
      <Bar className="h-[2px] w-2/3 opacity-30" />
      <span className="flex flex-1 gap-[3px]">
        <span className="w-1/4 rounded-[1px] bg-current opacity-25" />
        <span className="flex-1 rounded-[1px] bg-primary opacity-80" />
      </span>
      <Grid cols={5} />
    </Frame>
  ),

  modern_shop: (
    <Frame>
      <Bar className="h-[3px] w-full opacity-60" />
      <span className="flex flex-1 gap-[4px]">
        <span className="w-1/5 rounded-[2px] bg-current opacity-20" />
        <span className="flex-1 rounded-[3px] bg-primary opacity-75" />
      </span>
      <Grid cols={4} />
    </Frame>
  ),

  fashion_boutique: (
    <Frame>
      <Bar className="h-[2px] w-1/2 self-center opacity-60" />
      <span className="flex-[1.6] rounded-[1px] bg-primary opacity-70" />
      <Grid cols={3} />
    </Frame>
  ),

  minimal_store: (
    <Frame>
      <Bar className="h-[2px] w-1/3 opacity-50" />
      <span className="flex-[2] rounded-[1px] bg-primary opacity-65" />
      <Grid cols={3} />
    </Frame>
  ),

  electronics: (
    <Frame dense>
      <Bar className="h-[3px] w-full opacity-60" />
      <Bar className="h-[2px] w-full opacity-25" />
      <span className="flex flex-1 gap-[3px]">
        <span className="w-1/4 rounded-[1px] bg-current opacity-25" />
        <span className="flex-1 rounded-[1px] bg-secondary opacity-85" />
      </span>
      <Grid cols={6} />
    </Frame>
  ),

  lifestyle: (
    <Frame>
      <Bar className="h-[2px] w-3/5 opacity-50" />
      <span className="flex flex-[1.4] gap-[4px]">
        <span className="flex-1 rounded-[2px] bg-current opacity-15" />
        <span className="flex-1 rounded-[2px] bg-primary opacity-70" />
      </span>
      <Grid cols={3} />
    </Frame>
  ),
};

export function TemplateThumbnail({ templateKey }: { templateKey: TemplateKey }) {
  return (
    <span className="block aspect-4/3 w-full overflow-hidden rounded-[3px] border border-border">
      {LAYOUTS[templateKey]}
    </span>
  );
}
