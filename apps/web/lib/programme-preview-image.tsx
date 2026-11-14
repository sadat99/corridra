import { pp } from './i18n/programme-pages';
import { webManifest } from './ux/web-manifest';

// The picture of a public programme page that a chat or social app shows beside the link (ADR-084 S1). It takes only the
// published title, where, when and organiser and whether the workspace is a sample one, so nothing private can reach it: a
// fee, a price, a place count, a person and a payment status are not inputs. Colours are the two AC/1 primitives the web
// manifest already names. The mark is the owned reversed orb file, handed in as a data address or left out.
export type PreviewImageInput = {
  title: string;
  destination: string;
  dates: string;
  organiser: string;
  sample: boolean;
  mark: string | null;
};
const clip = (text: string, max: number) =>
  [...text].length <= max
    ? text
    : [...text]
        .slice(0, max - 1)
        .join('')
        .trimEnd() + '…';

export function previewImage(input: PreviewImageInput) {
  const navy = webManifest.theme_color;
  const porcelain = webManifest.background_color;
  const title = clip(input.title, 110);
  const row = (label: string, value: string) => (
    <div tw="flex flex-col mt-4">
      <div tw="flex text-[22px] opacity-75">{label}</div>
      <div tw="flex text-[32px]">{clip(value, 90)}</div>
    </div>
  );
  return (
    <div
      tw="flex flex-col justify-between w-full h-full p-16"
      style={{ background: navy, color: porcelain }}
    >
      <div tw="flex items-center text-[24px] tracking-widest">
        {input.mark ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={input.mark} width={44} height={44} alt="" tw="mr-4" />
        ) : null}
        <div tw="flex">
          {input.sample ? pp('pp.public.eyebrowSample') : pp('pp.public.eyebrow')}
        </div>
      </div>
      <div tw="flex flex-col">
        <div
          tw={
            title.length > 70 ? 'flex text-[48px] leading-tight' : 'flex text-[64px] leading-tight'
          }
        >
          {title}
        </div>
        {row(pp('pp.public.fact.where'), input.destination)}
        {row(pp('pp.public.fact.when'), input.dates)}
      </div>
      <div tw="flex text-[24px] opacity-90">
        {clip(`${pp('pp.public.fact.organiser')} ${input.organiser}`, 100)}
      </div>
    </div>
  );
}
