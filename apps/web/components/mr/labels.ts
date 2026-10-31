import { translate, type MessageKey } from '../../lib/i18n/messages';
import { defaultLocale, type Locale } from '../../lib/i18n/locales';

/**
 * The words the teaching-layer components show. They come from the message module, so English is the
 * source and every other language is a draft until a native reviewer is recorded (locales.ts). A
 * component never hard-codes a second copy: a caller passes `mrLabelsFor(locale)` and the component
 * falls back to English when it is given nothing.
 * Plain, short and common words (UI direction, "Words"): "Sample", never "synthetic"; "Corridra
 * team", never "operator". Move and Road are figures of speech and are explained at first use.
 */
type Say = (key: MessageKey) => string;

function build(say: Say) {
  return {
    road: {
      title: say('mr.road.title'),
      steps: {
        define: say('mr.road.step.define'),
        find: say('mr.road.step.find'),
        compare: say('mr.road.step.compare'),
        visit: say('mr.road.step.visit'),
        decide: say('mr.road.step.decide'),
        follow: say('mr.road.step.follow'),
      },
      states: {
        done: say('mr.road.state.done'),
        now: say('mr.road.state.now'),
        later: say('mr.road.state.later'),
        notTracked: say('mr.road.state.notTracked'),
      },
      legend: say('mr.road.legend'),
      sublines: {
        // D6: a mission exists only once the customer has sent the request, so a DRAFT mission is a
        // received request waiting for review, never an unsent draft.
        DRAFT: say('wsb.status.received'),
        QUALIFICATION: say('mr.road.subline.QUALIFICATION'),
        ACTIVE: say('mr.road.subline.ACTIVE'),
        TARGETING: say('mr.road.subline.TARGETING'),
        OUTREACH: say('mr.road.subline.OUTREACH'),
        MEETINGS: say('mr.road.subline.MEETINGS'),
        FOLLOW_UP: say('mr.road.subline.FOLLOW_UP'),
        COMMERCIAL_PIPELINE: say('mr.road.subline.COMMERCIAL_PIPELINE'),
        CLOSED: say('mr.road.subline.CLOSED'),
      },
      asides: {
        on_hold: say('mr.road.aside.on_hold'),
        cancelled: say('mr.road.aside.cancelled'),
        unknown: say('mr.road.aside.unknown'),
      },
    },
    holder: {
      you: say('mr.holder.you'),
      team: say('mr.holder.team'),
      third: say('mr.holder.third'),
    },
    move: {
      due: say('mr.move.due'),
      explainer: say('mr.move.explainer'),
      /** Word order differs by language, so the sentence is a pattern with {verb} and {object}. */
      phrase: say('mr.move.phrase'),
      verbs: {
        Read: say('mr.verb.read'),
        Answer: say('mr.verb.answer'),
        Add: say('mr.verb.add'),
        Confirm: say('mr.verb.confirm'),
        Choose: say('mr.verb.choose'),
        Send: say('mr.verb.send'),
      },
    },
    quote: {
      comparable: say('mr.quote.comparable'),
      notComparable: say('mr.quote.notComparable'),
      unitPrice: say('mr.quote.unitPrice'),
      total: say('mr.quote.total'),
      notStated: say('mr.quote.notStated'),
      revision: say('mr.quote.revision'),
      missing: say('mr.quote.missing'),
    },
    ghost: { example: say('mr.ghost.example') },
    mode: { sample: say('mr.mode.sample'), real: say('mr.mode.real') },
  };
}

export type MrLabels = ReturnType<typeof build>;

/** The labels for one language. A missing or empty entry falls back to English inside `translate`. */
export function mrLabelsFor(locale: Locale): MrLabels {
  return build((key) => translate(locale, key));
}

export const mrLabels: MrLabels = mrLabelsFor(defaultLocale);

/** Fills {verb} and {object} in a Move sentence pattern. */
export function movePhrase(pattern: string, verb: string, object: string): string {
  return pattern.replace('{verb}', verb).replace('{object}', object);
}
