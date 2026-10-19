import { Redirect } from 'expo-router';

/**
 * expo-router serves a page listing every route at /_sitemap, in production
 * web builds as well as in development. That hands anyone the admin and
 * moderation paths, so it is replaced with a redirect home.
 */
export default function NoSitemap() {
  return <Redirect href="/" />;
}
