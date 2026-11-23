import { field } from './headers.js';

/** Weak diagnostics only. The verifier's transport contract is external HTTPS. */
export function headerMismatch(h: Map<string, string[]>, method: string): boolean {
  const ua = field(h, 'user-agent');
  // iOS browsers use WebKit; WebViews and explicit privacy derivatives have different defaults.
  if (
    /CriOS|EdgiOS|iPhone|iPad|iPod|; wv\)|WebView|FBAN|FBAV|Instagram|Line\/|MicroMessenger|BytedanceWebview|GSA\/|Version\/4\.0 Chrome\/|Electron\/|QtWebEngine\/|Vivaldi\/|YaBrowser\/|DuckDuckGo\/|MiuiBrowser|Silk\/|UCBrowser\/|OPR\/|SamsungBrowser\/|bot|crawler|spider/i.test(
      ua,
    )
  )
    return false;
  const chrome = /(?:Chrome|HeadlessChrome)\/(\d+)\./.exec(ua);
  const edge = /Edg(?:A)?\/(\d+)\./.exec(ua);
  if (!chrome) return false;
  const version = Number(chrome[1]);
  const edgeVersion = edge ? Number(edge[1]) : undefined;
  const has = (name: string) => field(h, name).length > 0;
  const site = field(h, 'sec-fetch-site');
  const mode = field(h, 'sec-fetch-mode');
  const dest = field(h, 'sec-fetch-dest');
  // Limit absence checks to recognizable navigations/resources. An Accept HTML GET is
  // a navigation-shaped claim, not proof of navigation; no inference from a URL suffix.
  const navigation = mode === 'navigate' || ['document', 'iframe', 'frame'].includes(dest);
  const resource = [
    'script',
    'style',
    'image',
    'font',
    'audio',
    'video',
    'worker',
    'sharedworker',
    'serviceworker',
    'manifest',
    'track',
    'embed',
    'object',
  ].includes(dest);
  const htmlGet =
    method === 'GET' &&
    !mode &&
    !dest &&
    (!site || site === 'none' || site === 'same-origin') &&
    /(?:^|[,;\s])text\/html(?:[,;\s]|$)/i.test(field(h, 'accept'));
  const eligible = navigation || resource || htmlGet;
  if (!eligible) return false;
  const fetchVersion = edgeVersion === undefined ? version >= 76 : edgeVersion >= 79;
  if (fetchVersion && (!has('sec-fetch-site') || !has('sec-fetch-mode'))) return true;
  // Dest shipped later than Site/Mode (Chrome/Edge 80).
  if (version >= 80 && (edgeVersion === undefined || edgeVersion >= 80) && !has('sec-fetch-dest'))
    return true;
  if (version < 89 || (edgeVersion !== undefined && edgeVersion < 89)) return false;
  // Cross-origin subresource client hints may be suppressed by Permissions Policy.
  // Iframes may also inherit policy. Only top-level navigation-shaped or same-origin resources.
  const hintsExpected =
    (dest !== 'iframe' && dest !== 'frame' && (navigation || htmlGet)) ||
    (resource && site === 'same-origin');
  if (
    hintsExpected &&
    [
      'sec-ch-ua',
      'sec-ch-ua-mobile',
      ...(version >= 93 && (edgeVersion === undefined || edgeVersion >= 93)
        ? ['sec-ch-ua-platform']
        : []),
    ].some((name) => !has(name))
  )
    return true;
  const platform = field(h, 'sec-ch-ua-platform');
  const expected = /Android/.test(ua)
    ? 'Android'
    : /CrOS/.test(ua)
      ? 'Chrome OS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : undefined;
  // Only compare recognized platforms; malformed/unknown values are not identity evidence.
  return (
    expected !== undefined &&
    !(expected === 'Linux' && platform === '"Android"') &&
    /^"(?:Android|Chrome OS|Windows|macOS|Linux)"$/.test(platform) &&
    platform !== '"' + expected + '"'
  );
}
