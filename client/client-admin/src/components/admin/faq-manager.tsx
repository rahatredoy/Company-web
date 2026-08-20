'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { FaqRow } from '@/lib/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogColumn,
  DialogColumns,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

/**
 * The questions the storefront's help page answers.
 *
 * Grouped by an optional free-text category rather than a fixed list, because
 * the useful groupings differ per shop — "Delivery" for one, "Sizing" for
 * another — and a closed vocabulary would be wrong for both.
 *
 * A question is switched off rather than deleted when it is seasonal: the answer
 * is usually still the one that will be wanted next time, and retyping it is how
 * two slightly different versions end up on the same page.
 */
export function FaqManager({ rows, canManage }: { rows: FaqRow[]; canManage: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FaqRow | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const openFor = (row: FaqRow | null) => {
    setEditing(row);
    setError('');
    setFieldErrors({});
    setOpen(true);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();

    const payload = {
      question: text('question'),
      answer: text('answer'),
      category: text('category') || null,
      isActive: data.get('isActive') === 'on',
      sortOrder: Number(data.get('sortOrder') ?? 0),
    };

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      if (editing) await api.put(`/api/v1/admin/website/faqs/${editing.id}`, payload);
      else await api.post('/api/v1/admin/website/faqs', payload);

      setOpen(false);
      toast.success('Question saved.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.details) {
        setFieldErrors(
          Object.fromEntries(Object.entries(caught.details).map(([key, messages]) => [key, messages[0] ?? ''])),
        );
      }
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: FaqRow) => {
    if (!window.confirm(`Delete “${row.question}”?`)) return;

    try {
      await api.delete(`/api/v1/admin/website/faqs/${row.id}`);
      toast.success('Question removed.');
      router.refresh();
    } catch (caught) {
      toast.error(errorMessage(caught));
    }
  };

  // Grouped for display only; order within a group is the stored sort order,
  // which the API already applied.
  const groups = React.useMemo(() => {
    const map = new Map<string, FaqRow[]>();
    for (const row of rows) {
      const key = row.category?.trim() || 'General';
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-6">
      {canManage ? (
        <Button size="sm" onClick={() => openFor(null)}>
          <Plus aria-hidden /> Add a question
        </Button>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No questions yet. The help page on your storefront stays empty until there are some.
          </CardContent>
        </Card>
      ) : (
        groups.map(([category, entries]) => (
          <section key={category} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">{category}</h2>

            <Card>
              <CardContent className="divide-y p-0">
                {entries.map((row) => (
                  <div key={row.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setExpanded((current) => (current === row.id ? null : row.id))}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        aria-expanded={expanded === row.id}
                      >
                        <ChevronDown
                          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                            expanded === row.id ? 'rotate-180' : ''
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block font-medium">{row.question}</span>
                          {expanded !== row.id ? (
                            <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                              {row.answer}
                            </span>
                          ) : null}
                        </span>
                      </button>

                      <div className="flex shrink-0 items-center gap-1">
                        {!row.isActive ? <Badge variant="neutral">Hidden</Badge> : null}
                        {canManage ? (
                          <>
                            <Button variant="ghost" size="icon-sm" onClick={() => openFor(row)} aria-label="Edit">
                              <Pencil aria-hidden />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => remove(row)} aria-label="Delete">
                              <Trash2 aria-hidden />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {expanded === row.id ? (
                      <p className="mt-2 pl-6 text-sm whitespace-pre-wrap text-muted-foreground">{row.answer}</p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit question' : 'New question'}</DialogTitle>
              <DialogDescription>Shown on your storefront’s help page, grouped by category.</DialogDescription>
            </DialogHeader>

            <DialogBody>
              {error ? <Alert variant="danger">{error}</Alert> : null}

              {/* The question and its answer on the left; where it files on the
                  right, so the answer box keeps a readable width. */}
              <DialogColumns>
                <DialogColumn>
                  <Field label="Question" htmlFor="question" required error={fieldErrors.question}>
                    <Input
                      id="question"
                      name="question"
                      defaultValue={editing?.question ?? ''}
                      maxLength={300}
                      placeholder="How long does delivery take?"
                    />
                  </Field>

                  <Field label="Answer" htmlFor="answer" required error={fieldErrors.answer}>
                    <Textarea id="answer" name="answer" rows={6} defaultValue={editing?.answer ?? ''} maxLength={4000} />
                  </Field>
                </DialogColumn>

                <DialogColumn>
                  <Field
                    label="Category"
                    htmlFor="category"
                    hint="A heading on the help page. Left empty means General."
                    error={fieldErrors.category}
                  >
                    <Input
                      id="category"
                      name="category"
                      defaultValue={editing?.category ?? ''}
                      maxLength={60}
                      placeholder="Delivery"
                    />
                  </Field>

                  <Field label="Order" htmlFor="sortOrder" hint="Lower shows first.">
                    <Input id="sortOrder" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
                  </Field>

                  <label className="flex items-center gap-3 text-sm">
                    <Switch name="isActive" defaultChecked={editing?.isActive ?? true} />
                    Show it on the storefront
                  </label>
                </DialogColumn>
              </DialogColumns>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save question
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
