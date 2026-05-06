'use client';

/**
 * DEPRECATED — redirects to /file-intake (Subscriber Onboarding)
 * The unified intake pipeline lives at /file-intake.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function IntakeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/file-intake');
  }, [router]);
  return null;
}
