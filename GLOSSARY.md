# Node Effect backend template

A reusable backend starter: an HTTP API and a worker over PostgreSQL. These are
the terms its code and documents use.

## Language

### Worker

**Job**: A named piece of recurring work the worker does. _Avoid_: task, worker
work

**Pass**: One run of a job. _Avoid_: tick, iteration

**Job table**: The list of every job a worker runs. _Avoid_: registry

**Job runner**: The module that runs a job table, as a one-shot pass or by
polling. _Avoid_: scheduler

**One-shot pass**: One pass of every job in the table, in order, after which the
process exits. _Avoid_: worker once

**Polling**: Running each job in its own loop, one pass at a time, waiting a
fixed interval after each pass. _Avoid_: scheduling
