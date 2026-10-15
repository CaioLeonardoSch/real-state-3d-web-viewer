// The fonts a client's site may pick (FONTS in ./config), served by the site itself: the build copies the latin files
// of the @fontsource packages into assets/. No request goes to Google, so the visitor's address is not shared with a
// third party (LGPD), the page needs no extra connection to start and the CSP allows fonts from 'self' only.
import type { FontKey, SiteConfig } from './config';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import montserrat400 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff2?url';
import montserrat600 from '@fontsource/montserrat/files/montserrat-latin-600-normal.woff2?url';
import montserrat700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url';
import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2?url';
import poppins600 from '@fontsource/poppins/files/poppins-latin-600-normal.woff2?url';
import poppins700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2?url';
import lato400 from '@fontsource/lato/files/lato-latin-400-normal.woff2?url';
import lato700 from '@fontsource/lato/files/lato-latin-700-normal.woff2?url';
import raleway400 from '@fontsource/raleway/files/raleway-latin-400-normal.woff2?url';
import raleway600 from '@fontsource/raleway/files/raleway-latin-600-normal.woff2?url';
import raleway700 from '@fontsource/raleway/files/raleway-latin-700-normal.woff2?url';
import playfair500 from '@fontsource/playfair-display/files/playfair-display-latin-500-normal.woff2?url';
import playfair700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url';
import lora500 from '@fontsource/lora/files/lora-latin-500-normal.woff2?url';
import lora700 from '@fontsource/lora/files/lora-latin-700-normal.woff2?url';

type WebFont = Exclude<FontKey, 'system'>;

/** Family name (as in FONTS[key].css) and the file of each weight. */
const FILES: Record<WebFont, { family: string; weights: Record<number, string> }> = {
  inter: { family: 'Inter', weights: { 400: inter400, 600: inter600, 700: inter700 } },
  montserrat: { family: 'Montserrat', weights: { 400: montserrat400, 600: montserrat600, 700: montserrat700 } },
  poppins: { family: 'Poppins', weights: { 400: poppins400, 600: poppins600, 700: poppins700 } },
  lato: { family: 'Lato', weights: { 400: lato400, 700: lato700 } },
  raleway: { family: 'Raleway', weights: { 400: raleway400, 600: raleway600, 700: raleway700 } },
  playfair: { family: 'Playfair Display', weights: { 500: playfair500, 700: playfair700 } },
  lora: { family: 'Lora', weights: { 500: lora500, 700: lora700 } },
};

/** @font-face rules for the fonts the site uses ('' when it only uses the system font). */
export function fontFaceCss(c: Pick<SiteConfig, 'font' | 'headingFont'>): string {
  const keys = [...new Set([c.font, c.headingFont])].filter((k): k is WebFont => k !== 'system');
  return keys
    .flatMap((k) =>
      Object.entries(FILES[k].weights).map(
        ([weight, url]) =>
          `@font-face{font-family:'${FILES[k].family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(${url}) format('woff2')}`,
      ),
    )
    .join('\n');
}
