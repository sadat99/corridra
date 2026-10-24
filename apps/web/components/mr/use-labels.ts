'use client';

import { useMemo } from 'react';
import { useLanguage } from '../language-provider';
import { mrLabelsFor, type MrLabels } from './labels';

/** The teaching-layer words in the language the person chose (English until they choose another). */
export function useMrLabels(): MrLabels {
  const { locale } = useLanguage();
  return useMemo(() => mrLabelsFor(locale), [locale]);
}
