"""Deterministic onboarding insights (F2) — a fixed catalog selected by MoE measure averages.

Each insight is gated by ranges on the official 1–5 measure averages
(`profile.mapping_measures`). A learner sees at most one insight per group:
specials first (random if more than fit), then commons fill the remaining
groups. Every group's commons cover the full 1.00–5.00 range, so five cards are
always available. Randomness is seeded by the learner id, so the same learner
always gets the same cards and openings, in every language.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from hashlib import sha256
import random
from typing import Any

CARD_COUNT = 5

# Pseudo-measure for group ב: the mean of growth mindset (2) and self-regulation (4).
CHALLENGE_MEASURE = "challenge"

Text = dict[str, Any]  # {"he": (male, female), "ar": (male, female), "en": str}


def _text(he: str | tuple[str, str], ar: str | tuple[str, str], en: str) -> Text:
    return {
        "he": he if isinstance(he, tuple) else (he, he),
        "ar": ar if isinstance(ar, tuple) else (ar, ar),
        "en": en,
    }


@dataclass(frozen=True)
class Insight:
    id: str
    group: str
    special: bool
    category: str
    conditions: tuple[tuple[int | str, float, float], ...]
    title: Text
    body: Text


GROUPS = {
    "a": {"icon_key": "interest", "measures": (1,)},
    "b": {"icon_key": "persistence", "measures": (2, 4)},
    "c": {"icon_key": "independence", "measures": (3,)},
    "d": {"icon_key": "self_awareness", "measures": (5,)},
    "e": {"icon_key": "belonging", "measures": (6,)},
    "f": {"icon_key": "technology", "measures": (7,)},
}

HIGH = (3.00, 5.00)
LOW = (1.00, 2.99)
STRONG = (4.00, 5.00)
TOP = (4.50, 5.00)


def _common(insight_id: str, group: str, measure: int | str, strength: bool, title: Text, body: Text) -> Insight:
    lo, hi = HIGH if strength else LOW
    return Insight(
        insight_id, group, False, "strength" if strength else "support",
        ((measure, lo, hi),), title, body,
    )


def _special(insight_id: str, group: str, conditions: tuple, title: Text, body: Text) -> Insight:
    flat = tuple((measure, lo, hi) for measure, (lo, hi) in conditions)
    return Insight(insight_id, group, True, "characteristic", flat, title, body)


CATALOG: tuple[Insight, ...] = (
    # ── א · מה מדרבן אותי בלמידה (measure 1) ──────────────────────────────────
    _common("a1", "a", 1, True,
        _text("יש לך רצון להצליח", "لديك رغبة في النجاح", "You want to succeed"),
        _text("חשוב לך להצליח, ויש נושאים שבאמת מעניינים אותך.",
              "النجاح مهم بالنسبة لك، وهناك مواضيع تثير اهتمامك حقًا.",
              "success matters to you, and some topics really interest you.")),
    _common("a2", "a", 1, False,
        _text("מחפשים את הניצוץ", "نبحث عن الشرارة", "Looking for the spark"),
        _text("הלמידה לא תמיד מרגישה לך מעניינת או קשורה לחיים שלך.",
              "التعلّم لا يبدو لك دائمًا ممتعًا أو مرتبطًا بحياتك.",
              "learning doesn't always feel interesting or connected to your life.")),
    _special("a3", "a", ((1, STRONG), (4, LOW)),
        _text("יש רצון, הדרך עוד מתגבשת", "الرغبة موجودة، والطريق ما زال يتشكّل",
              "The drive is there, the path is still taking shape"),
        _text("יש לך רצון אמיתי ללמוד ולהצליח, אבל לא תמיד קל לך לתכנן משימה או לבדוק שהבנת.",
              ("لديك رغبة حقيقية في التعلّم والنجاح، لكن ليس من السهل عليك دائمًا أن تخطّط لمهمة أو تتأكد من أنك فهمت.",
               "لديكِ رغبة حقيقية في التعلّم والنجاح، لكن ليس من السهل عليكِ دائمًا أن تخطّطي لمهمة أو تتأكدي من أنكِ فهمتِ."),
              "you really want to learn and succeed, but planning a task or checking that you understood isn't always easy.")),
    _special("a4", "a", ((1, LOW), (2, STRONG)),
        _text("היכולת קיימת, חסר החיבור", "القدرة موجودة، وينقص الارتباط",
              "The ability is there, the connection is missing"),
        _text(("אתה מאמין ביכולת שלך להשתפר, אבל החומר עצמו לא תמיד מעניין אותך או מרגיש קשור אליך.",
               "את מאמינה ביכולת שלך להשתפר, אבל החומר עצמו לא תמיד מעניין אותך או מרגיש קשור אלייך."),
              ("أنت تؤمن بقدرتك على التحسّن، لكن المادة نفسها لا تثير اهتمامك دائمًا أو لا تبدو مرتبطة بك.",
               "أنتِ تؤمنين بقدرتكِ على التحسّن، لكن المادة نفسها لا تثير اهتمامكِ دائمًا أو لا تبدو مرتبطة بكِ."),
              "you believe you can improve, but the material itself doesn't always interest you or feel connected to you.")),

    # ── ב · איך אני ניגש/ת לאתגר (mean of measures 2 and 4) ──────────────────
    _common("b1", "b", CHALLENGE_MEASURE, True,
        _text(("לא מוותר", "לא מוותרת"), ("لا تستسلم", "لا تستسلمين"), "You don't give up"),
        _text(("אתה ממשיך לנסות גם כשקשה.", "את ממשיכה לנסות גם כשקשה."),
              ("أنت تواصل المحاولة حتى عندما يكون الأمر صعبًا.", "أنتِ تواصلين المحاولة حتى عندما يكون الأمر صعبًا."),
              "you keep trying even when it's hard.")),
    _common("b2", "b", CHALLENGE_MEASURE, False,
        _text(("עוד לומד להתמודד", "עוד לומדת להתמודד"),
              ("ما زلت تتعلّم كيف تواجه التحديات", "ما زلتِ تتعلّمين كيف تواجهين التحديات"),
              "Still learning to handle challenges"),
        _text("כשמשהו קשה, לא תמיד קל לך להמשיך לנסות.",
              ("عندما يكون شيء ما صعبًا، ليس من السهل عليك دائمًا أن تواصل المحاولة.",
               "عندما يكون شيء ما صعبًا، ليس من السهل عليكِ دائمًا أن تواصلي المحاولة."),
              "when something is hard, it isn't always easy for you to keep trying.")),
    _special("b3", "b", ((2, STRONG), (4, LOW)),
        _text(("מאמין בעצמך", "מאמינה בעצמך"), ("تؤمن بنفسك", "تؤمنين بنفسكِ"), "You believe in yourself"),
        _text(("אתה בטוח שתוכל להשתפר, אבל לפעמים קשה לך להתארגן.",
               "את בטוחה שתוכלי להשתפר, אבל לפעמים קשה לך להתארגן."),
              ("أنت واثق من أنك تستطيع التحسّن، لكن أحيانًا يصعب عليك تنظيم نفسك.",
               "أنتِ واثقة من أنكِ تستطيعين التحسّن، لكن أحيانًا يصعب عليكِ تنظيم نفسكِ."),
              "you're sure you can improve, but sometimes it's hard for you to get organized.")),
    _special("b4", "b", ((2, LOW), (4, STRONG)),
        _text(("מסודר בעבודה", "מסודרת בעבודה"), ("منظّم في عملك", "منظّمة في عملكِ"), "Organized in your work"),
        _text(("אתה מתכנן את העבודה שלך, אבל לא תמיד בטוח שתצליח להשתפר.",
               "את מתכננת את העבודה שלך, אבל לא תמיד בטוחה שתצליחי להשתפר."),
              ("أنت تخطّط لعملك، لكنك لست متأكدًا دائمًا من أنك ستنجح في التحسّن.",
               "أنتِ تخطّطين لعملكِ، لكنكِ لستِ متأكدة دائمًا من أنكِ ستنجحين في التحسّن."),
              "you plan your work, but you're not always sure you'll manage to improve.")),
    _special("b5", "b", ((2, TOP), (4, TOP)),
        _text(("יודע להתמודד", "יודעת להתמודד"),
              ("تعرف كيف تواجه التحديات", "تعرفين كيف تواجهين التحديات"),
              "You know how to handle challenges"),
        _text(("אתה מאמין בעצמך, מתכנן את העבודה ויודע להירגע כשקשה.",
               "את מאמינה בעצמך, מתכננת את העבודה ויודעת להירגע כשקשה."),
              ("أنت تؤمن بنفسك، وتخطّط لعملك، وتعرف كيف تهدأ عندما يكون الأمر صعبًا.",
               "أنتِ تؤمنين بنفسكِ، وتخطّطين لعملكِ، وتعرفين كيف تهدئين عندما يكون الأمر صعبًا."),
              "you believe in yourself, plan your work, and know how to calm down when it's hard.")),

    # ── ג · לקיחת אחריות (measure 3) ─────────────────────────────────────────
    _common("c1", "c", 3, True,
        _text(("לוקח אחריות", "לוקחת אחריות"), ("تتحمّل المسؤولية", "تتحمّلين المسؤولية"), "You take responsibility"),
        _text(("אתה מרגיש אחראי על הלמידה שלך ומנסה קודם לבד.",
               "את מרגישה אחראית על הלמידה שלך ומנסה קודם לבד."),
              ("أنت تشعر بأنك مسؤول عن تعلّمك وتحاول وحدك أولًا.",
               "أنتِ تشعرين بأنكِ مسؤولة عن تعلّمكِ وتحاولين وحدكِ أولًا."),
              "you feel responsible for your learning and try on your own first.")),
    _common("c2", "c", 3, False,
        _text("צעד אחרי צעד", "خطوة بعد خطوة", "Step by step"),
        _text("לא תמיד קל לך להציב מטרות ולעמוד בזמנים שקבעת.",
              ("ليس من السهل عليك دائمًا أن تضع أهدافًا وتلتزم بالمواعيد التي حدّدتها.",
               "ليس من السهل عليكِ دائمًا أن تضعي أهدافًا وتلتزمي بالمواعيد التي حدّدتِها."),
              "setting goals and sticking to the times you planned isn't always easy for you.")),
    _special("c3", "c", ((3, STRONG), (6, LOW)),
        _text(("סומך על עצמך", "סומכת על עצמך"), ("تعتمد على نفسك", "تعتمدين على نفسكِ"), "You rely on yourself"),
        _text(("אתה לוקח אחריות על הלמידה, אבל לא תמיד מרגיש שיש לך למי לפנות.",
               "את לוקחת אחריות על הלמידה, אבל לא תמיד מרגישה שיש לך למי לפנות."),
              ("أنت تتحمّل مسؤولية تعلّمك، لكنك لا تشعر دائمًا بأن هناك من يمكنك اللجوء إليه.",
               "أنتِ تتحمّلين مسؤولية تعلّمكِ، لكنكِ لا تشعرين دائمًا بأن هناك من يمكنكِ اللجوء إليه."),
              "you take responsibility for your learning, but you don't always feel there's someone to turn to.")),
    _special("c4", "c", ((3, LOW), (1, STRONG)),
        _text("רוצה להצליח", ("تريد أن تنجح", "تريدين أن تنجحي"), "Eager to succeed"),
        _text("חשוב לך להצליח, אבל עוד לא תמיד קל לך לתכנן איך להגיע לשם.",
              ("النجاح مهم بالنسبة لك، لكن ليس من السهل عليك دائمًا بعد أن تخطّط كيف تصل إليه.",
               "النجاح مهم بالنسبة لكِ، لكن ليس من السهل عليكِ دائمًا بعد أن تخطّطي كيف تصلين إليه."),
              "success matters to you, but planning how to get there isn't always easy yet.")),
    _special("c5", "c", ((3, TOP),),
        _text(("מוביל את הלמידה", "מובילה את הלמידה"), ("تقود تعلّمك", "تقودين تعلّمكِ"), "You lead your learning"),
        _text(("אתה מציב לעצמך מטרות, עומד בזמנים ולוקח אחריות על הלמידה.",
               "את מציבה לעצמך מטרות, עומדת בזמנים ולוקחת אחריות על הלמידה."),
              ("أنت تضع لنفسك أهدافًا، وتلتزم بالمواعيد، وتتحمّل مسؤولية تعلّمك.",
               "أنتِ تضعين لنفسكِ أهدافًا، وتلتزمين بالمواعيد، وتتحمّلين مسؤولية تعلّمكِ."),
              "you set goals for yourself, stick to your plans, and take responsibility for your learning.")),

    # ── ד · איך אני לומד/ת (measure 5) ───────────────────────────────────────
    _common("d1", "d", 5, True,
        _text(("מכיר את עצמך", "מכירה את עצמך"), ("تعرف نفسك", "تعرفين نفسكِ"), "You know yourself"),
        _text(("אתה יודע מה עוזר לך ללמוד ומה קשה לך.", "את יודעת מה עוזר לך ללמוד ומה קשה לך."),
              ("أنت تعرف ما الذي يساعدك على التعلّم وما الذي يصعب عليك.",
               "أنتِ تعرفين ما الذي يساعدكِ على التعلّم وما الذي يصعب عليكِ."),
              "you know what helps you learn and what's hard for you.")),
    _common("d2", "d", 5, False,
        _text("עוד מגלה מה מתאים לך", ("ما زلت تكتشف ما يناسبك", "ما زلتِ تكتشفين ما يناسبكِ"),
              "Still discovering what works for you"),
        _text("לא תמיד קל לך לדעת מה עוזר לך ללמוד או מה בדיוק לא ברור.",
              ("ليس من السهل عليك دائمًا أن تعرف ما الذي يساعدك على التعلّم أو ما الذي ليس واضحًا بالضبط.",
               "ليس من السهل عليكِ دائمًا أن تعرفي ما الذي يساعدكِ على التعلّم أو ما الذي ليس واضحًا بالضبط."),
              "it isn't always easy for you to know what helps you learn or what exactly is unclear.")),
    _special("d3", "d", ((5, STRONG), (2, LOW)),
        _text(("יודע מה קשה לך", "יודעת מה קשה לך"), ("تعرف ما الذي يصعب عليك", "تعرفين ما الذي يصعب عليكِ"),
              "You know what's hard for you"),
        _text(("אתה מזהה מה קשה לך, אבל לא תמיד בטוח שתצליח להשתפר בזה.",
               "את מזהה מה קשה לך, אבל לא תמיד בטוחה שתצליחי להשתפר בזה."),
              ("أنت تلاحظ ما الذي يصعب عليك، لكنك لست متأكدًا دائمًا من أنك ستنجح في التحسّن فيه.",
               "أنتِ تلاحظين ما الذي يصعب عليكِ، لكنكِ لستِ متأكدة دائمًا من أنكِ ستنجحين في التحسّن فيه."),
              "you notice what's hard for you, but you're not always sure you'll manage to improve at it.")),
    _special("d4", "d", ((5, LOW), (3, STRONG)),
        _text(("מחפש את הדרך שלך", "מחפשת את הדרך שלך"), ("تبحث عن طريقك", "تبحثين عن طريقكِ"),
              "Finding your own way"),
        _text(("אתה לוקח אחריות על הלמידה, אבל עוד לא תמיד יודע מה הכי עוזר לך.",
               "את לוקחת אחריות על הלמידה, אבל עוד לא תמיד יודעת מה הכי עוזר לך."),
              ("أنت تتحمّل مسؤولية تعلّمك، لكنك لا تعرف دائمًا بعد ما الذي يساعدك أكثر.",
               "أنتِ تتحمّلين مسؤولية تعلّمكِ، لكنكِ لا تعرفين دائمًا بعد ما الذي يساعدكِ أكثر."),
              "you take responsibility for your learning, but you don't always know yet what helps you most.")),
    _special("d5", "d", ((5, TOP),),
        _text(("לומד מכל ניסיון", "לומדת מכל ניסיון"), ("تتعلّم من كل تجربة", "تتعلّمين من كل تجربة"),
              "You learn from every experience"),
        _text(("אתה חושב על ההצלחות והטעויות שלך ולומד מהן.", "את חושבת על ההצלחות והטעויות שלך ולומדת מהן."),
              ("أنت تفكّر في نجاحاتك وأخطائك وتتعلّم منها.", "أنتِ تفكّرين في نجاحاتكِ وأخطائكِ وتتعلّمين منها."),
              "you think about your successes and mistakes and learn from them.")),

    # ── ה · עזרה ותמיכה (measure 6) ──────────────────────────────────────────
    _common("e1", "e", 6, True,
        _text("יש לך על מי לסמוך", ("لديك من تعتمد عليه", "لديكِ من تعتمدين عليه"), "You have people to count on"),
        _text(("אתה מרגיש שהמורה והחברים יכולים לעזור לך כשקשה.",
               "את מרגישה שהמורה והחברים יכולים לעזור לך כשקשה."),
              ("أنت تشعر بأن المعلّم والأصدقاء يستطيعون مساعدتك عندما يكون الأمر صعبًا.",
               "أنتِ تشعرين بأن المعلّم والأصدقاء يستطيعون مساعدتكِ عندما يكون الأمر صعبًا."),
              "you feel your teacher and friends can help you when things are hard.")),
    _common("e2", "e", 6, False,
        _text("לבקש עזרה זה לא תמיד פשוט", "طلب المساعدة ليس سهلًا دائمًا", "Asking for help isn't always simple"),
        _text("לא תמיד קל לך לבקש עזרה מהמורה או מהחברים בכיתה.",
              ("ليس من السهل عليك دائمًا أن تطلب المساعدة من المعلّم أو من الأصدقاء في الصف.",
               "ليس من السهل عليكِ دائمًا أن تطلبي المساعدة من المعلّم أو من الأصدقاء في الصف."),
              "it isn't always easy for you to ask your teacher or classmates for help.")),
    _special("e3", "e", ((6, STRONG), (3, LOW)),
        _text(("יודע לבקש עזרה", "יודעת לבקש עזרה"), ("تعرف كيف تطلب المساعدة", "تعرفين كيف تطلبين المساعدة"),
              "You know how to ask for help"),
        _text("קל לך לבקש עזרה, אבל פחות קל לך לנסות קודם לבד.",
              ("من السهل عليك أن تطلب المساعدة، لكن من الأصعب عليك أن تحاول وحدك أولًا.",
               "من السهل عليكِ أن تطلبي المساعدة، لكن من الأصعب عليكِ أن تحاولي وحدكِ أولًا."),
              "asking for help comes easily to you, but trying on your own first is harder.")),
    _special("e4", "e", ((6, LOW), (1, STRONG)),
        _text(("רוצה להצליח, מחפש הבנה", "רוצה להצליח, מחפשת הבנה"),
              ("تريد أن تنجح، وتبحث عمّن يفهمك", "تريدين أن تنجحي، وتبحثين عمّن يفهمكِ"),
              "Eager to succeed, looking to be understood"),
        _text(("חשוב לך להצליח, אבל לא תמיד אתה מרגיש שמבינים מה מעניין אותך.",
               "חשוב לך להצליח, אבל לא תמיד את מרגישה שמבינים מה מעניין אותך."),
              ("النجاح مهم بالنسبة لك، لكنك لا تشعر دائمًا بأنهم يفهمون ما يثير اهتمامك.",
               "النجاح مهم بالنسبة لكِ، لكنكِ لا تشعرين دائمًا بأنهم يفهمون ما يثير اهتمامكِ."),
              "success matters to you, but you don't always feel people understand what interests you.")),
    _special("e5", "e", ((6, TOP),),
        _text("חלק מהכיתה", "جزء من الصف", "Part of the class"),
        _text(("אתה משתף רעיונות בשיעור ומרגיש שהמורה מבין אותך.",
               "את משתפת רעיונות בשיעור ומרגישה שהמורה מבין אותך."),
              ("أنت تشارك أفكارك في الدرس وتشعر بأن المعلّم يفهمك.",
               "أنتِ تشاركين أفكاركِ في الدرس وتشعرين بأن المعلّم يفهمكِ."),
              "you share ideas in class and feel your teacher understands you.")),

    # ── ו · טכנולוגיה (measure 7) ────────────────────────────────────────────
    _common("f1", "f", 7, True,
        _text(("מרגיש בנוח עם מחשב", "מרגישה בנוח עם מחשב"),
              ("تشعر بالراحة مع الحاسوب", "تشعرين بالراحة مع الحاسوب"), "Comfortable with computers"),
        _text(("נוח לך ללמוד עם מחשב, ואתה מסתדר איתו היטב.", "נוח לך ללמוד עם מחשב, ואת מסתדרת איתו היטב."),
              ("من المريح لك أن تتعلّم بالحاسوب، وأنت تتعامل معه جيدًا.",
               "من المريح لكِ أن تتعلّمي بالحاسوب، وأنتِ تتعاملين معه جيدًا."),
              "learning with a computer feels comfortable, and you handle it well.")),
    _common("f2", "f", 7, False,
        _text("מחברת או מסך?", "دفتر أم شاشة؟", "Notebook or screen?"),
        _text("ללמוד עם מחשב לא תמיד מרגיש לך הכי מתאים.",
              ("التعلّم بالحاسوب لا يبدو لك دائمًا الأنسب.", "التعلّم بالحاسوب لا يبدو لكِ دائمًا الأنسب."),
              "learning with a computer doesn't always feel like the best fit for you.")),
    _special("f3", "f", ((7, STRONG), (1, LOW)),
        _text("המסך מתאים לך", ("الشاشة تناسبك", "الشاشة تناسبكِ"), "The screen suits you"),
        _text("הלמידה לא תמיד מעניינת אותך, אבל ללמוד עם מחשב מרגיש לך נוח.",
              ("التعلّم لا يثير اهتمامك دائمًا، لكن التعلّم بالحاسوب يبدو مريحًا لك.",
               "التعلّم لا يثير اهتمامكِ دائمًا، لكن التعلّم بالحاسوب يبدو مريحًا لكِ."),
              "learning doesn't always interest you, but learning with a computer feels comfortable.")),
    _special("f4", "f", ((7, LOW), (5, STRONG)),
        _text(("יודע מה מתאים לך", "יודעת מה מתאים לך"), ("تعرف ما يناسبك", "تعرفين ما يناسبكِ"),
              "You know what fits you"),
        _text(("אתה יודע מה עוזר לך ללמוד, ומחשב פחות מתאים לך.", "את יודעת מה עוזר לך ללמוד, ומחשב פחות מתאים לך."),
              ("أنت تعرف ما الذي يساعدك على التعلّم، والحاسوب أقل ملاءمة لك.",
               "أنتِ تعرفين ما الذي يساعدكِ على التعلّم، والحاسوب أقل ملاءمة لكِ."),
              "you know what helps you learn, and a computer fits you less.")),
    _special("f5", "f", ((7, TOP),),
        _text("המחשב הוא הכלי שלך", ("الحاسوب هو أداتك", "الحاسوب هو أداتكِ"), "The computer is your tool"),
        _text(("אתה מעדיף ללמוד עם מחשב, מסתדר איתו ומתרכז מולו היטב.",
               "את מעדיפה ללמוד עם מחשב, מסתדרת איתו ומתרכזת מולו היטב."),
              ("أنت تفضّل التعلّم بالحاسوب، وتتعامل معه وتركّز أمامه جيدًا.",
               "أنتِ تفضّلين التعلّم بالحاسوب، وتتعاملين معه وتركّزين أمامه جيدًا."),
              "you prefer learning with a computer, handle it well, and focus in front of it.")),
)

CATALOG_BY_ID = {insight.id: insight for insight in CATALOG}

# Hebrew openings end in "ש" and the English ones in "that"/"like", so any body
# follows any opening; the Arabic ones end in a comma before a full clause.
OPENINGS = {
    "he": (
        "נראה ש", "מהתשובות שלך עולה ש", "התשובות שלך מראות ש", "אפשר לראות ש",
        "מהבחירות שלך נראה ש", "נשמע ש", "מתוך השאלון עולה ש", "מהדרך שבה ענית נראה ש",
    ),
    "ar": (
        "بحسب إجاباتك، ", "كما يظهر من إجاباتك، ", "من خلال إجاباتك، ", "بناءً على ما شاركته، ",
        "كما يبدو من اختياراتك، ", "من طريقة إجابتك، ", "وفقًا للاستبيان، ", "على ما يبدو، ",
    ),
    "en": (
        "It seems that ", "Your answers suggest that ", "Your answers show that ", "It looks like ",
        "From your choices, it seems that ", "It sounds like ", "The questionnaire suggests that ",
        "From the way you answered, it seems that ",
    ),
}

EVIDENCE_LABEL = {
    "he": "מבוסס על התשובות שלך בשאלון",
    "ar": "بناءً على إجاباتك في الاستبيان",
    "en": "Based on your questionnaire answers",
}


def _two_decimals(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def measure_values(measure_results: list[dict[str, Any]] | None) -> dict[int | str, float]:
    """Answered official measures (1–7) plus the group-ב challenge mean."""
    values: dict[int | str, float] = {}
    for item in measure_results or []:
        if not isinstance(item, dict):
            continue
        try:
            number = int(item.get("measure"))
            average = float(item.get("average"))
        except (TypeError, ValueError):
            continue
        if 1 <= number <= 7 and 1.0 <= average <= 5.0:
            values[number] = _two_decimals(average)
    if 2 in values and 4 in values:
        values[CHALLENGE_MEASURE] = _two_decimals((values[2] + values[4]) / 2)
    return values


def matches(insight: Insight, values: dict[int | str, float]) -> bool:
    return all(
        measure in values and lo <= values[measure] <= hi
        for measure, lo, hi in insight.conditions
    )


def _rng(learner_id: str) -> random.Random:
    digest = sha256(f"profile-insights:{learner_id}".encode("utf-8")).hexdigest()
    return random.Random(int(digest[:16], 16))


def select_insights(values: dict[int | str, float], learner_id: str) -> list[tuple[Insight, int]]:
    """Pick up to five insights (one per group) and an opening index for each."""
    rng = _rng(learner_id)
    matched = [insight for insight in CATALOG if matches(insight, values)]
    chosen: list[Insight] = []
    used_groups: set[str] = set()
    for special in (True, False):
        pool = [insight for insight in matched if insight.special is special]
        rng.shuffle(pool)
        for insight in pool:
            if len(chosen) >= CARD_COUNT:
                break
            if insight.group not in used_groups:
                chosen.append(insight)
                used_groups.add(insight.group)
    openings = rng.sample(range(len(OPENINGS["he"])), len(chosen))
    return list(zip(chosen, openings))


def resolve(text: Text, language: str, gender: str) -> str:
    if language == "en":
        return text["en"]
    male, female = text[language]
    return female if gender == "female" else male


def render_claim(insight: Insight, opening: int, language: str, gender: str) -> dict[str, Any]:
    source_id = f"insight:{insight.id}"
    return {
        "id": source_id,
        "source_id": source_id,
        "category": insight.category,
        "title": resolve(insight.title, language, gender),
        "description": OPENINGS[language][opening] + resolve(insight.body, language, gender),
        "icon_key": GROUPS[insight.group]["icon_key"],
        "evidence_label": EVIDENCE_LABEL[language],
    }


def insight_measures(insight: Insight) -> list[int]:
    measures: list[int] = []
    for measure, _lo, _hi in insight.conditions:
        for number in GROUPS[insight.group]["measures"] if measure == CHALLENGE_MEASURE else (measure,):
            if number not in measures:
                measures.append(number)
    return measures
