import { redirect } from 'next/navigation';

/**
 * `/about` is a shortcut to the store's own About page.
 *
 * The content is CMS-authored like every other page, so this redirects rather
 * than duplicating the renderer — one place decides how store-authored HTML is
 * sanitised and displayed.
 */
export default function AboutPage() {
  redirect('/page/about');
}
