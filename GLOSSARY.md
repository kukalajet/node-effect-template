# Node Effect backend template

A reusable backend starter: an HTTP API and a worker over PostgreSQL. These are
the terms its code and documents use.

## Language

### Persistence

**Persistence failure**: A repository error for an operation the database could
not complete, such as after a lost connection, a timeout, or stored data that no
longer decodes. _Avoid_: database error

**Domain error**: An expected outcome of an operation that a caller can act on,
such as a user that does not exist or an email that is already taken. _Avoid_:
business exception

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
