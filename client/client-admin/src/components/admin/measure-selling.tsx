'use client';

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  DEFAULT_MEASURE_OPTIONS,
  MAX_MEASURE_OPTIONS,
  MEASURE_UNIT_CHOICES,
  formatMeasure,
  priceForMeasure,
  type MeasureOption,
  type MeasureUnit,
} from '@/lib/measure';
import { SELECT_CLASS } from './category-tree';

const CONTROL = 'h-9';
const TIGHT = 'space-y-1.5';

/**
 * "Sold by weight or volume" — the switch that puts a size picker on the card.
 *
 * The shop types **one rate** (৳40 per 1kg) and ticks the sizes it will weigh
 * out; every option's price is derived from the rate rather than typed, which is
 * the whole reason this is not four variants. A greengrocer with sixty
 * vegetables would otherwise be maintaining two hundred and forty prices.
 *
 * The preview under the options is doing real work rather than decorating: the
 * rate and the size are two numbers whose product nobody computes in their head
 * reliably, and getting it wrong prices the shop's whole vegetable aisle. It is
 * computed with the same helper the API charges with, so what is shown here is
 * what a customer is billed.
 *
 * Everything reaches the form through hidden inputs. The controls themselves are
 * held in React state because they are interdependent — turning the switch off
 * has to stop the fields below it being read at all — and a `Switch` contributes
 * nothing to `FormData` on its own.
 */
export function MeasureSelling({
  product,
  storeDefaults,
  price,
  currency,
  fieldErrors,
  onEnabledChange,
}: {
  product?: {
    sellBy?: 'unit' | 'measure' | null;
    measureUnit?: string | null;
    pricingMeasure?: number | null;
    pricingLabel?: string | null;
    minMeasure?: number | null;
    measureOptions?: MeasureOption[] | null;
  } | null;
  /** The shop's own list, which a product with none of its own falls back to. */
  storeDefaults?: MeasureOption[] | null;
  /** The regular price as it currently stands in the form, for the preview. */
  price: string;
  currency: string;
  fieldErrors: Record<string, string>;
  /**
   * Told when the switch moves, for a form that shows the price somewhere this
   * block is not — the create panel keeps the price up front and this under
   * Advanced options, and the price box has to say it has become a rate.
   */
  onEnabledChange?: (enabled: boolean) => void;
}) {
  const t = useT();
  const [enabled, setEnabledState] = React.useState(product?.sellBy === 'measure');
  const setEnabled = (next: boolean) => {
    setEnabledState(next);
    onEnabledChange?.(next);
  };
  const [unit, setUnit] = React.useState<MeasureUnit>((product?.measureUnit as MeasureUnit) ?? 'g');
  const [pricingMeasure, setPricingMeasure] = React.useState(String(product?.pricingMeasure ?? 1000));
  const [minMeasure, setMinMeasure] = React.useState(product?.minMeasure ? String(product.minMeasure) : '');

  /*
   * Null on the product means "use the shop's list", and that is a real state
   * rather than an empty one — so the editor opens on whichever list is actually
   * in force, and only sends a list of its own once the owner changes it.
   */
  const inherited =
    storeDefaults && storeDefaults.length > 0 ? storeDefaults : DEFAULT_MEASURE_OPTIONS;
  const [own, setOwn] = React.useState<MeasureOption[] | null>(product?.measureOptions ?? null);
  const options = own ?? inherited;

  const rate = Number(price) || 0;
  const per = Number(pricingMeasure) || 1;

  const update = (next: MeasureOption[]) => setOwn(next);

  const addOption = () =>
    update([...options, { label: '', measure: 0 }].slice(0, MAX_MEASURE_OPTIONS));

  const editOption = (index: number, patch: Partial<MeasureOption>) =>
    update(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));

  const removeOption = (index: number) => update(options.filter((_, i) => i !== index));

  /*
   * Only the rows worth sending. A half-typed row — a label with no amount — is
   * dropped rather than rejected, because the owner is mid-thought and a
   * validation error on a row they are still filling in is noise.
   */
  const payload = options.filter((option) => option.measure > 0 && option.label.trim() !== '');

  return (
    <div className="space-y-3">
      {/*
        Sent on every save, including when it is off — switching a product back
        to ordinary selling is a change the API has to hear about, and an omitted
        field means "leave it alone".
      */}
      <input type="hidden" name="sellBy" value={enabled ? 'measure' : 'unit'} />

      <div className="flex items-start gap-3">
        <Switch id="sellByMeasure" checked={enabled} onCheckedChange={setEnabled} />
        <div className="space-y-0.5">
          <Label htmlFor="sellByMeasure" className="cursor-pointer">
            {t('Sold by weight or volume')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {unit === 'pc'
              ? t('The card shows a size picker — 1kg, 500gm, 250gm — and one price per piece covers all of them.')
              : unit === 'ml'
                ? t('The card shows a size picker — 1kg, 500gm, 250gm — and one price per litre covers all of them.')
                : t('The card shows a size picker — 1kg, 500gm, 250gm — and one price per kilo covers all of them.')}
          </p>
        </div>
      </div>

      {enabled ? (
        <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
          <input type="hidden" name="measureUnit" value={unit} />
          <input type="hidden" name="pricingMeasure" value={pricingMeasure} />
          <input type="hidden" name="minMeasure" value={minMeasure} />
          {/*
            An empty list is a deliberate null: it means "use the shop's default
            picker", never "offer nothing". The API reads it the same way.
          */}
          <input
            type="hidden"
            name="measureOptions"
            value={own === null ? '' : JSON.stringify(payload)}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Measured in')} htmlFor="measureUnitSelect" className={TIGHT}>
              <select
                id="measureUnitSelect"
                value={unit}
                onChange={(event) => {
                  const next = event.target.value as MeasureUnit;
                  setUnit(next);
                  // The old rate is meaningless in the new unit — 1000 pieces is
                  // not what a shop switching to "per piece" meant to say.
                  setPricingMeasure(next === 'pc' ? '1' : '1000');
                  setOwn(next === 'pc' ? [{ label: '1pc', measure: 1 }] : null);
                }}
                className={cn(SELECT_CLASS, CONTROL)}
              >
                {MEASURE_UNIT_CHOICES.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {t(choice.label)}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={t('Price is for')}
              htmlFor="pricingMeasureInput"
              hint={t('In {unit}. {amount} means the price above is per {measure}.', {
                unit,
                amount: '1000',
                measure: formatMeasure(1000, unit),
              })}
              error={fieldErrors.pricingMeasure}
              className={TIGHT}
            >
              <Input
                id="pricingMeasureInput"
                inputMode="numeric"
                value={pricingMeasure}
                onChange={(event) => setPricingMeasure(event.target.value.replace(/[^0-9]/g, ''))}
                className={CONTROL}
              />
            </Field>

            <Field
              label={t('Label on the card')}
              htmlFor="pricingLabel"
              hint={t('Empty prints it from the amount above.')}
              className={TIGHT}
            >
              <Input
                id="pricingLabel"
                name="pricingLabel"
                defaultValue={product?.pricingLabel ?? ''}
                placeholder={t('Per {measure}', { measure: formatMeasure(per, unit) })}
                maxLength={24}
                className={CONTROL}
              />
            </Field>

            <Field
              label={t('Smallest order')}
              htmlFor="minMeasureInput"
              hint={
                minMeasure
                  ? t('Shows as "Min. {measure}" on the card.', { measure: formatMeasure(Number(minMeasure), unit) })
                  : t('Empty sells any size on the list.')
              }
              error={fieldErrors.minMeasure}
              className={TIGHT}
            >
              <Input
                id="minMeasureInput"
                inputMode="numeric"
                value={minMeasure}
                onChange={(event) => setMinMeasure(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder={t('e.g. {example}', { example: '350' })}
                className={CONTROL}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t('Sizes a customer can pick')}
              </Label>
              {own === null ? (
                <span className="text-xs text-muted-foreground">{t("Using the shop's default list")}</span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setOwn(null)}
                >
                  {t("Use the shop's list")}
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option.label}
                    onChange={(event) => editOption(index, { label: event.target.value })}
                    // i18n-ignore — a size, not language
                    placeholder="500gm"
                    maxLength={24}
                    className={cn(CONTROL, 'flex-1')}
                    aria-label={t('Size {number} label', { number: index + 1 })}
                  />
                  <Input
                    value={option.measure > 0 ? String(option.measure) : ''}
                    onChange={(event) =>
                      editOption(index, { measure: Number(event.target.value.replace(/[^0-9]/g, '')) || 0 })
                    }
                    placeholder={unit}
                    inputMode="numeric"
                    className={cn(CONTROL, 'w-24')}
                    aria-label={t('Size {number} amount in {unit}', { number: index + 1, unit })}
                  />
                  {/*
                    The price nobody works out in their head. Same helper the API
                    charges with, so this is the number, not an approximation.
                  */}
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {option.measure > 0 && rate > 0
                      ? currency + ' ' + priceForMeasure(rate, option.measure, per)
                      : '—'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    onClick={() => removeOption(index)}
                    aria-label={t('Remove size {number}', { number: index + 1 })}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>

            {options.length < MAX_MEASURE_OPTIONS ? (
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={addOption}>
                <Plus className="mr-1 size-3.5" aria-hidden /> {t('Add a size')}
              </Button>
            ) : null}

            {fieldErrors.measureOptions ? (
              <p className="text-xs text-destructive">{fieldErrors.measureOptions}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
