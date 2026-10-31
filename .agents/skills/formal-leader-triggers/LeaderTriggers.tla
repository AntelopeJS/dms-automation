--------------------------- MODULE LeaderTriggers ---------------------------
(***************************************************************************)
(* Leader election and singleton trigger arming of @antelopejs/dms-       *)
(* automation in redis mode (src/cluster/leader.ts, src/index.ts,         *)
(* src/runtime/subscriptions.ts, src/runtime/reconcile.ts).               *)
(*                                                                         *)
(* Each instance runs the leader tick every TTL/3 (leader.ts:10, 160): it *)
(* renews the key `dms-automation:leader` while it believes it holds it,  *)
(* or tries SET NX PX otherwise. Winning or losing queues a reconcile on  *)
(* the instance's serial queue (subscriptions.ts:61-63, 202-211), and the *)
(* reconcile arms the singleton triggers only when it reads leadership    *)
(* (reconcile.ts:246-264). destroy() stops the election, then the bus,    *)
(* then tears the handles down (index.ts:163-168).                        *)
(*                                                                         *)
(* One Redis round trip, applied and answered, is one step. Time moves in *)
(* ticks; one tick is TTL/3, so the key lives TTL ticks. An instance can  *)
(* stall: it simply takes no step while time passes.                      *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
  Instances,    \* processes running the module in redis mode
  TTL,          \* TTL_MS (leader.ts:8), in ticks of TICK_MS = TTL_MS / 3
  MaxErrors,    \* Redis commands that fail in one behaviour
  MaxExternal,  \* reconciles a bus message or a procedure edit queues
  MaxStops,     \* instances that run destroy()
  MaxTime       \* the last tick

None == "none"

VARIABLES
  now,      \* Date.now(), in ticks
  owner,    \* the instance id stored at dms-automation:leader, or None
  expires,  \* the tick the key expires at
  holds,    \* holdsLock of each instance (leader.ts:36)
  lastHeld, \* lastHeldAt of each instance (leader.ts:50)
  due,      \* the interval fired since the last runTick (leader.ts:160)
  pc,       \* where each instance's in-flight tick is (leader.ts:110-132)
  ticket,   \* the reconcile a promotion or step-down awaits
  queued,   \* reconciles queued on each instance's serial queue
  done,     \* reconciles that finished
  rpc,      \* the reconcile running now: "none", or "apply" once it read leadership
  rsnap,    \* the leadership that reconcile read (reconcile.ts:250)
  armed,    \* whether the instance's singleton trigger handle is armed
  life,     \* "running", "stopping" or "stopped"
  spc,      \* where destroy() is (index.ts:163-168, leader.ts:169-190)
  errors,
  external,
  stops

vars == <<now, owner, expires, holds, lastHeld, due, pc, ticket, queued, done,
          rpc, rsnap, armed, life, spc, errors, external, stops>>

PCs == {"idle", "renew", "set", "promoteWait", "stepDownWait"}
SPCs == {"none", "wait", "release", "bus", "deactivate", "done"}

Init ==
  /\ now = 0
  /\ owner = None /\ expires = 0
  /\ holds = [i \in Instances |-> FALSE]
  /\ lastHeld = [i \in Instances |-> 0]
  /\ due = [i \in Instances |-> TRUE]                          \* leader.ts:159
  /\ pc = [i \in Instances |-> "idle"]
  /\ ticket = [i \in Instances |-> 0]
  /\ queued = [i \in Instances |-> 0]
  /\ done = [i \in Instances |-> 0]
  /\ rpc = [i \in Instances |-> "none"]
  /\ rsnap = [i \in Instances |-> FALSE]
  /\ armed = [i \in Instances |-> FALSE]
  /\ life = [i \in Instances |-> "running"]
  /\ spc = [i \in Instances |-> "none"]
  /\ errors = 0 /\ external = 0 /\ stops = 0

TypeOK ==
  /\ now \in 0..MaxTime
  /\ owner \in Instances \cup {None}
  /\ \A i \in Instances :
       /\ pc[i] \in PCs /\ spc[i] \in SPCs
       /\ rpc[i] \in {"none", "apply"}
       /\ done[i] <= queued[i]
       /\ life[i] \in {"running", "stopping", "stopped"}

KeyFree == owner = None \/ expires <= now

(* Queue one reconcile on i's serial queue and await it.                 *)
QueueAndWait(i, wait) ==
  /\ queued' = [queued EXCEPT ![i] = @ + 1]
  /\ ticket' = [ticket EXCEPT ![i] = queued[i] + 1]
  /\ pc' = [pc EXCEPT ![i] = wait]

Steady == UNCHANGED <<now, due, armed, life, spc, external, stops, rpc, rsnap, done>>

(* ------------------------------ the tick -------------------------------- *)

(* runTick skips while a tick is in flight (leader.ts:140-141, 111). A   *)
(* holder sends the owner-checked renew, a follower SET NX PX            *)
(* (lines 115-123).                                                       *)
RunTick(i) ==
  /\ life[i] = "running"
  /\ due[i]
  /\ due' = [due EXCEPT ![i] = FALSE]
  /\ pc' = IF pc[i] # "idle" THEN pc
           ELSE [pc EXCEPT ![i] = IF holds[i] THEN "renew" ELSE "set"]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, ticket, queued, done,
                 rpc, rsnap, armed, life, spc, errors, external, stops>>

(* RENEW_LUA extends the key only while it is still ours (leader.ts:18-19). *)
(* Renewed: lastHeldAt moves (line 120). Answered 0: step down, which     *)
(* clears holdsLock and awaits the reconcile onLostLeadership queues      *)
(* (lines 119, 58-65). A Redis error steps down only once TTL has passed  *)
(* since the last confirmed hold (lines 126-128).                         *)
RenewReply(i) ==
  /\ pc[i] = "renew"
  /\ \/ /\ owner = i /\ expires > now
        /\ expires' = now + TTL
        /\ lastHeld' = [lastHeld EXCEPT ![i] = now]
        /\ pc' = [pc EXCEPT ![i] = "idle"]
        /\ UNCHANGED <<owner, holds, ticket, queued, errors>>
     \/ /\ ~(owner = i /\ expires > now)
        /\ holds' = [holds EXCEPT ![i] = FALSE]
        /\ QueueAndWait(i, "stepDownWait")
        /\ UNCHANGED <<owner, expires, lastHeld, errors>>
     \/ /\ errors < MaxErrors
        /\ errors' = errors + 1
        /\ IF holds[i] /\ now - lastHeld[i] > TTL
           THEN /\ holds' = [holds EXCEPT ![i] = FALSE]
                /\ QueueAndWait(i, "stepDownWait")
           ELSE /\ pc' = [pc EXCEPT ![i] = "idle"]
                /\ UNCHANGED <<holds, ticket, queued>>
        /\ UNCHANGED <<owner, expires, lastHeld>>
  /\ Steady

(* SET NX PX answers OK on a free key: promote sets holdsLock and         *)
(* lastHeldAt, then awaits the reconcile onBecameLeader queues            *)
(* (leader.ts:123-125, 86-99). A taken key ends the tick. A Redis error    *)
(* ends it too, since the instance holds nothing (line 128).              *)
SetReply(i) ==
  /\ pc[i] = "set"
  /\ \/ /\ KeyFree
        /\ owner' = i /\ expires' = now + TTL
        /\ holds' = [holds EXCEPT ![i] = TRUE]
        /\ lastHeld' = [lastHeld EXCEPT ![i] = now]
        /\ QueueAndWait(i, "promoteWait")
        /\ UNCHANGED errors
     \/ /\ ~KeyFree
        /\ pc' = [pc EXCEPT ![i] = "idle"]
        /\ UNCHANGED <<owner, expires, holds, lastHeld, ticket, queued, errors>>
     \/ /\ errors < MaxErrors
        /\ errors' = errors + 1
        /\ pc' = [pc EXCEPT ![i] = "idle"]
        /\ UNCHANGED <<owner, expires, holds, lastHeld, ticket, queued>>
  /\ Steady

(* The reconcile the promotion or step-down queued has finished.          *)
TickDone(i) ==
  /\ pc[i] \in {"promoteWait", "stepDownWait"}
  /\ done[i] >= ticket[i]
  /\ pc' = [pc EXCEPT ![i] = "idle"]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, ticket, queued, done,
                 rpc, rsnap, armed, life, spc, errors, external, stops>>

(* ------------------------------ reconcile ------------------------------- *)

(* The next queued reconcile reads the procedures, then snapshots          *)
(* leadership once for the whole pass (reconcile.ts:246-250).             *)
ReconcileRead(i) ==
  /\ rpc[i] = "none"
  /\ done[i] < queued[i]
  /\ rpc' = [rpc EXCEPT ![i] = "apply"]
  /\ rsnap' = [rsnap EXCEPT ![i] = holds[i]]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, pc, ticket, queued, done,
                 armed, life, spc, errors, external, stops>>

(* It arms the singleton when it read leadership and tears it down        *)
(* otherwise (reconcile.ts:252-263, 78-82).                               *)
ReconcileApply(i) ==
  /\ rpc[i] = "apply"
  /\ armed' = [armed EXCEPT ![i] = rsnap[i]]
  /\ rpc' = [rpc EXCEPT ![i] = "none"]
  /\ done' = [done EXCEPT ![i] = @ + 1]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, pc, ticket, queued,
                 rsnap, life, spc, errors, external, stops>>

(* A peer's edit on the bus, or a procedure edit here, queues a reconcile *)
(* (subscriptions.ts:159-165, 212-217, 241-248).                         *)
External(i) ==
  /\ external < MaxExternal
  /\ external' = external + 1
  /\ queued' = [queued EXCEPT ![i] = @ + 1]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, pc, ticket, done,
                 rpc, rsnap, armed, life, spc, errors, stops>>

(* ------------------------------ destroy --------------------------------- *)

(* destroy() calls leader.stop(), which clears the interval (index.ts:166,     *)
(* leader.ts:170-173).                                                    *)
StopBegin(i) ==
  /\ life[i] = "running"
  /\ stops < MaxStops
  /\ stops' = stops + 1
  /\ life' = [life EXCEPT ![i] = "stopping"]
  /\ spc' = [spc EXCEPT ![i] = "wait"]
  /\ due' = [due EXCEPT ![i] = FALSE]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, pc, ticket, queued, done,
                 rpc, rsnap, armed, errors, external>>

(* stop() awaits the in-flight tick, but at most SHUTDOWN_GRACE_MS        *)
(* (leader.ts:174-182): the tick may still be running when it moves on.   *)
StopWait(i) ==
  /\ spc[i] = "wait"
  /\ spc' = [spc EXCEPT ![i] = "release"]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, pc, ticket, queued, done,
                 rpc, rsnap, armed, life, errors, external, stops>>

(* While it still believes it holds the lock, RELEASE_LUA deletes the key *)
(* if it is ours; then holdsLock is cleared (leader.ts:183-186, 21-22).   *)
StopRelease(i) ==
  /\ spc[i] = "release"
  /\ IF holds[i] /\ owner = i /\ expires > now
     THEN owner' = None /\ expires' = 0
     ELSE UNCHANGED <<owner, expires>>
  /\ holds' = [holds EXCEPT ![i] = FALSE]
  /\ spc' = [spc EXCEPT ![i] = "bus"]
  /\ UNCHANGED <<now, lastHeld, due, pc, ticket, queued, done, rpc, rsnap,
                 armed, life, errors, external, stops>>

(* destroy() then awaits bus.close() (index.ts:167).                      *)
StopBus(i) ==
  /\ spc[i] = "bus"
  /\ spc' = [spc EXCEPT ![i] = "deactivate"]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, pc, ticket, queued, done,
                 rpc, rsnap, armed, life, errors, external, stops>>

(* _deactivateAll tears down every handle, outside the reconcile queue    *)
(* (index.ts:168, subscriptions.ts:419-426).                              *)
StopDeactivate(i) ==
  /\ spc[i] = "deactivate"
  /\ armed' = [armed EXCEPT ![i] = FALSE]
  /\ spc' = [spc EXCEPT ![i] = "done"]
  /\ life' = [life EXCEPT ![i] = "stopped"]
  /\ UNCHANGED <<now, owner, expires, holds, lastHeld, due, pc, ticket, queued, done,
                 rpc, rsnap, errors, external, stops>>

(* ------------------------------ the clock ------------------------------- *)

(* One TICK_MS passes: the interval of every running instance fires.     *)
Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ due' = [i \in Instances |-> IF life[i] = "running" THEN TRUE ELSE due[i]]
  /\ UNCHANGED <<owner, expires, holds, lastHeld, pc, ticket, queued, done,
                 rpc, rsnap, armed, life, spc, errors, external, stops>>

Busy ==
  \/ \E i \in Instances :
       \/ RunTick(i) \/ RenewReply(i) \/ SetReply(i) \/ TickDone(i)
       \/ ReconcileRead(i) \/ ReconcileApply(i) \/ External(i)
       \/ StopBegin(i) \/ StopWait(i) \/ StopRelease(i) \/ StopBus(i)
       \/ StopDeactivate(i)
  \/ Tick

(* Once nothing can happen, the system stays as it is. This step keeps   *)
(* /statechart from reading the end as a deadlock.                       *)
Settled == ~ENABLED Busy /\ UNCHANGED vars

Next == Busy \/ Settled

Spec == Init /\ [][Next]_vars

InstanceSymmetry == Permutations(Instances)

(* ------------------------------- rules --------------------------------- *)

(* At most one instance has the singleton triggers armed.                *)
AtMostOneArmed == \A i, j \in Instances : armed[i] /\ armed[j] => i = j

(* An armed instance believes it holds the lock.                         *)
ArmedImpliesBelief == \A i \in Instances : armed[i] => holds[i]

(* Once destroy() returned, the instance is disarmed and holds no key.   *)
StopDisarms ==
  \A i \in Instances : life[i] = "stopped" =>
    /\ ~armed[i]
    /\ ~holds[i]
    /\ ~(owner = i /\ expires > now)

=============================================================================
