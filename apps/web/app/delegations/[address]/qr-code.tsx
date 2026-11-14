import { makeQr, qrDataAddress, quietZone } from '../../../lib/programme-qr';

/**
 * A QR code of one address, made on the server and handed to the page as an image that holds its own picture (a data
 * address), so nothing is loaded and nothing is called. The address is dark on light in plain black and white on purpose:
 * a scanner needs that contrast whatever the page theme is.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const code = makeQr(text);
  const side = code.size + 2 * quietZone;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="programme-qr"
      src={qrDataAddress(code)}
      width={side}
      height={side}
      alt={label}
    />
  );
}
