'use client';
// A trust label kept in English on a translated page (CQ-48). Its tooltip (also read by screen
// readers as the description) says why, in the chosen language. The label text itself stays exactly
// the trust name. Owner: WS-E.
import type { ReactNode } from 'react';
import { useLanguage } from '../language-provider';

export function TrustTag({
  as: Tag,
  tone,
  children,
}: {
  as: 'span' | 'h2' | 'h3';
  tone: string;
  children: ReactNode;
}) {
  const { locale, t } = useLanguage();
  const note = t('wse.trust.note');
  return (
    <Tag
      className="guide-tag"
      data-tone={tone}
      lang="en"
      title={locale === 'en' ? undefined : note}
    >
      {children}
    </Tag>
  );
}
