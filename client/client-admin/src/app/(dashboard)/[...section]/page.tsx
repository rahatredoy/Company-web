import { notFound } from 'next/navigation';

/**
 * Anything under the dashboard that is not a real page.
 *
 * This used to render a "coming soon" screen for the sixteen sidebar entries
 * that had no page yet — without it they fell through to the bare Next.js 404,
 * a black screen outside the shell that reads as a broken panel rather than an
 * unfinished one.
 *
 * Every nav destination now exists, so that branch is unreachable and has been
 * removed rather than left to rot. What remains is the honest answer to a typo
 * or a stale bookmark: a real 404, inside the shell.
 *
 * A static `page.tsx` always wins over this catch-all, so adding a route needs
 * no change here.
 */
export default function DashboardNotFound(): never {
  notFound();
}
