import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the person has asked their device to reduce motion.
 *
 * Looping animation is the kind that actually makes people ill, so anything
 * that repeats on its own should hold still when this is true and show the
 * finished state instead — the point is the result, not the movement.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (live) setReduce(v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { live = false; sub.remove(); };
  }, []);

  return reduce;
}
