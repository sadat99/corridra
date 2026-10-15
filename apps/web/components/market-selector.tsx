'use client';
import Link from 'next/link';
import { useState } from 'react';
import { countryCodes } from '@corridra/domain/countries';
export function MarketSelector() {
  const [company, setCompany] = useState(''),
    [market, setMarket] = useState('');
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const initial = company === 'BD' && ['CN', 'ES', 'EU'].includes(market);
  return (
    <section className="detail-card market-selector" aria-label="Choose a commercial route">
      <h2>Which markets matter to your mission?</h2>
      <label>
        Company country
        <select value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">Choose a country</option>
          {countryCodes.map((code) => (
            <option key={code} value={code}>
              {names.of(code)} ({code})
            </option>
          ))}
        </select>
      </label>
      <label>
        Target market
        <select value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">Choose a market</option>
          <option value="EU">European Union (trade bloc)</option>
          {countryCodes.map((code) => (
            <option key={code} value={code}>
              {names.of(code)} ({code})
            </option>
          ))}
        </select>
      </label>
      {company && market && (
        <>
          <p role="status">
            {initial
              ? 'An initial direction in the product design.'
              : 'This direction can be described in an example request. No operating offer is announced for this route.'}{' '}
          </p>
          <Link
            className="primary-link"
            href={`/plan?companyCountry=${company}&marketCode=${market}`}
          >
            Prepare an example request
          </Link>
        </>
      )}
    </section>
  );
}
