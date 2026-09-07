import React from 'react';
import { LegalScreen } from '@/components/LegalScreen';
import { GUIDELINES } from '@/content/legal';

export default function GuidelinesScreen() {
  return <LegalScreen doc={GUIDELINES} />;
}
