'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { PageDetail } from '@/lib/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toaster';

const SELECT_CLASS = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

/**
 * Editing a CMS page.
 *
 * The body is raw HTML in a textarea rather than a rich-text editor, and that is
 * a deliberate limit rather than a shortcut: the API sanitises against an
 * allow-list on write, so only a small set of tags survives whatever is typed
 * here. An editor that offered formatting the sanitiser then stripped would be
 * lying about what it saved.
 *
 * A **policy page cannot be deleted** — the footer and the checkout copy link to
 * it by `systemKey`, so removing one leaves dead links nobody thinks to look
 * for. Emptying or unpublishing it is the way to retire one.
 */
export function PageEditor({ page, canManage }: { page: PageDetail | null; canManage: boolean }) {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;

    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const optional = (name: string) => text(name) || null;

    const payload = {
      title: text('title'),
      // Only sent when it changed — the API re-derives a slug solely when the
      // slug itself was the field being edited, so a live address never moves
      // because somebody fixed a typo in the title.
      ...(page && text('slug') === page.slug ? {} : { slug: text('slug') || undefined }),
      excerpt: optional('excerpt'),
      bodyHtml: optional('bodyHtml'),
      status: text('status'),
      showInFooter: data.get('showInFooter') === 'on',
      sortOrder: Number(data.get('sortOrder') ?? 0),
      seoTitle: optional('seoTitle'),
      seoDescription: optional('seoDescription'),
    };

    setSaving(true);
    setError('');
    setFieldErrors({});

    try {
      if (page) {
        await api.put(`/api/v1/admin/website/pages/${page.id}`, payload);
        toast.success('Page saved.');
        router.refresh();
      } else {
        const created = await api.post<{ id: string }>('/api/v1/admin/website/pages', payload);
        toast.success('Page created.');
        router.push(`/website/pages/${created.id}`);
      }
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

  const onDelete = async () => {
    if (!page || !window.confirm(`Delete “${page.title}” permanently?`)) return;

    setDeleting(true);

    try {
      await api.delete(`/api/v1/admin/website/pages/${page.id}`);
      toast.success('Page deleted.');
      router.push('/website/pages');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <Field label="Title" htmlFor="title" required error={fieldErrors.title}>
                <Input id="title" name="title" defaultValue={page?.title ?? ''} maxLength={200} disabled={!canManage} />
              </Field>

              <Field
                label="Address"
                htmlFor="slug"
                error={fieldErrors.slug}
                hint={
                  page
                    ? `Lives at /page/${page.slug}. Changing this breaks every existing link to it.`
                    : 'Left empty, this is made from the title.'
                }
              >
                <Input id="slug" name="slug" defaultValue={page?.slug ?? ''} maxLength={220} disabled={!canManage} />
              </Field>

              <Field label="Summary" htmlFor="excerpt" hint="Used in search results and link previews.">
                <Textarea
                  id="excerpt"
                  name="excerpt"
                  rows={2}
                  maxLength={500}
                  defaultValue={page?.excerpt ?? ''}
                  disabled={!canManage}
                />
              </Field>

              <Field
                label="Body"
                htmlFor="bodyHtml"
                error={fieldErrors.bodyHtml}
                hint="HTML. Only a small set of tags survives — headings, paragraphs, lists, links, tables."
              >
                <Textarea
                  id="bodyHtml"
                  name="bodyHtml"
                  rows={18}
                  className="font-mono text-xs"
                  defaultValue={page?.bodyHtml ?? ''}
                  disabled={!canManage}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search engines</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Title tag" htmlFor="seoTitle">
                <Input id="seoTitle" name="seoTitle" maxLength={160} defaultValue={page?.seoTitle ?? ''} disabled={!canManage} />
              </Field>
              <Field label="Meta description" htmlFor="seoDescription">
                <Textarea
                  id="seoDescription"
                  name="seoDescription"
                  rows={2}
                  maxLength={300}
                  defaultValue={page?.seoDescription ?? ''}
                  disabled={!canManage}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Publishing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Status" htmlFor="status">
                <select
                  id="status"
                  name="status"
                  defaultValue={page?.status ?? 'draft'}
                  className={SELECT_CLASS}
                  disabled={!canManage}
                >
                  <option value="draft">Draft — nobody can see it</option>
                  <option value="published">Published — live on your site</option>
                </select>
              </Field>

              <label className="flex items-center gap-3 text-sm">
                <Switch name="showInFooter" defaultChecked={page?.showInFooter ?? false} disabled={!canManage} />
                Link to it from the footer
              </label>

              <Field label="Order" htmlFor="sortOrder" hint="Lower shows first in the footer.">
                <Input
                  id="sortOrder"
                  name="sortOrder"
                  type="number"
                  defaultValue={page?.sortOrder ?? 0}
                  disabled={!canManage}
                />
              </Field>

              {page?.systemKey ? (
                <Alert variant="info">
                  This is one of your policy pages, so it cannot be deleted. Unpublish it instead if
                  you do not want it.
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          {canManage ? (
            <div className="space-y-2">
              <Button type="submit" className="w-full" loading={saving}>
                {page ? 'Save page' : 'Create page'}
              </Button>
              {page && !page.systemKey ? (
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full"
                  loading={deleting}
                  onClick={onDelete}
                >
                  Delete page
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}
