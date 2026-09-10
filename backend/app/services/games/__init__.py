"""Learning Game Lab — AI-created learning games owned by one learner.

The learner picks a learning objective and one of its components, describes a
game, and a worker (``workers/game_gen``) builds one self-contained HTML file
whose mechanics carry what that lesson teaches. This package is the Yuvi side:

    store                  the two collections (games, jobs) and the admin caps
    html_store             where the HTML lives — never Mongo
    jobs                   the job envelope the worker consumes, and how it is queued
    learning_descriptions  the one cached paragraph per lesson the builder designs around
    budget                 daily caps and the cost report
    narration              what Yuvi is doing right now, for the build page
    notify                 bell + realtime frames for the learner

See ``docs/design/learning-game-lab.md``.
"""
