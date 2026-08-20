'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { ProductSpecificationRow } from '@/lib/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';

const LIMIT = 100;

interface Draft {
  key: string;
  groupName: string;
  label: string;
  value: string;
  isKeySpec: boolean;
}

let counter = 0;
const nextKey = () => `spec-${(counter += 1)}`;

/**
 * The specification table on the product page — "Screen: 6.1 inch".
 *
 * A group is optional and is only a heading: rows sharing one are shown
 * together. **Key specs** are the handful that also appear on the comparison
 * table, so they are a flag rather than a separate list — the same row cannot
 * drift between the two places it is shown.
 *
 * Saved as a whole list, so a row deleted here is a row deleted in the database
 * on the next save and not before.
 */
export function ProductSpecifications({
  productId,
  specifications,
  canManage,
}: {
  productId: string;
  specifications: ProductSpecificationRow[];
  canManage: boolean;
}) {
  const router = useRouter();

  const [rows, setRows] = React.useState<Draft[]>(() =>
    specifications.map((row) => ({
      key: nextKey(),
      groupName: row.groupName ?? '',
      label: row.label,
      value: row.value,
      isKeySpec: row.isKeySpec,
    })),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const patch = (key: string, change: Partial<Draft>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const save = async () => {
    setSaving(true);
    setError('');

    // A row needs both halves to mean anything; one with neither is an empty
    // slot somebody opened, so it is dropped rather than refused.
    const payload = rows
      .filter((row) => row.label.trim() !== '' || row.value.trim() !== '')
      .map((row, index) => ({
        groupName: row.groupName.trim() || null,
        label: row.label.trim(),
        value: row.value.trim(),
        isKeySpec: row.isKeySpec,
        sortOrder: index * 10,
      }));

    try {
      await api.put(`/api/v1/admin/products/${productId}/specifications`, { specifications: payload });
      toast.success(payload.length === 0 ? 'Specifications cleared.' : 'Specifications saved.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Specifications</CardTitle>
        <CardDescription>
          The detail table on the product page. Group is a heading and is optional; tick <em>Key</em> to also show
          the row when shoppers compare products.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <Alert variant="danger">{error}</Alert> : null}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No specifications yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li key={row.key} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[9rem_1fr_1fr_auto]">
                <Input
                  value={row.groupName}
                  onChange={(event) => patch(row.key, { groupName: event.target.value })}
                  placeholder="Group"
                  maxLength={80}
                  aria-label={`Row ${index + 1} group`}
                  disabled={!canManage}
                />
                <Input
                  value={row.label}
                  onChange={(event) => patch(row.key, { label: event.target.value })}
                  placeholder="Screen"
                  maxLength={120}
                  aria-label={`Row ${index + 1} name`}
                  disabled={!canManage}
                />
                <Input
                  value={row.value}
                  onChange={(event) => patch(row.key, { value: event.target.value })}
                  placeholder="6.1 inch"
                  maxLength={400}
                  aria-label={`Row ${index + 1} value`}
                  disabled={!canManage}
                />

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={row.isKeySpec}
                      onCheckedChange={(checked) => patch(row.key, { isKeySpec: checked === true })}
                      disabled={!canManage}
                    />
                    Key
                  </label>
                  {canManage ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                      aria-label={`Remove row ${index + 1}`}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={rows.length >= LIMIT}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { key: nextKey(), groupName: '', label: '', value: '', isKeySpec: false },
                ])
              }
            >
              <Plus aria-hidden /> Add a row
            </Button>
            <Button type="button" size="sm" className="ml-auto" onClick={save} loading={saving}>
              Save specifications
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
