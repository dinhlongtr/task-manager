# Security Specification & Payload-First TDD (`Sổ Tay Công Tác` — Multi-User RBAC)

## 1. Access Control Model & Relationship Mapping
- **Bootstrapped Super Admin & Multi-User RBAC**:
  - Super Admin (`dinhlong.tran932@gmail.com` with `request.auth.token.email_verified == true`) always holds immutable root admin privileges and cannot be deleted, suspended, or demoted.
  - Additional users are pre-authorized and managed exclusively by Admins inside `/appUsers/{emailKey}` where `emailKey` is the normalized lowercase email address.
  - Roles: `admin`, `manager`, `staff`, `viewer`. Status: `active`, `suspended`.
  - Granular permissions: `canManageWork`, `canManageLocations`, `canViewContacts`, `canManageContacts`, `canUseAI`, `canPrintReports`.
  - Revocation is synchronous: setting `status = 'suspended'` or deleting `/appUsers/{emailKey}` immediately blocks all Firestore reads/writes for that user.
- **Anti-Privilege-Escalation**:
  - Non-admin users can NEVER list `/appUsers`, create `/appUsers`, delete `/appUsers`, or modify `role`, `status`, `email`, `createdBy`, or any `can*` permission flags.
  - Regular users may only `get` their own `/appUsers/{selfEmail}` doc and perform a restricted self-link update on `['uid', 'lastLoginIso', 'updatedAt']` where `incoming().uid == request.auth.uid` and `existing().uid` is empty or already equals `request.auth.uid`.
- **Relational Integrity & PII Isolation**:
  - `Location` (`/locations/{locationId}`): readable by active authorized users; writable only by admins or users with `canManageLocations == true`.
  - `WorkItem` (`/workItems/{workItemId}`): readable by active authorized users; creation requires `canManageWork()` + `incoming().ownerId == request.auth.uid` + `exists(locationId)` + `contactId == '' || exists(contactId)`. Updates follow tiered identity logic: Tier 1 (Admin/Manager/Creator with `canManageWork`) full edit; Tier 2 (Staff) status & reminder toggle only; Viewer blocked.
  - `Contact` (`/contacts/{contactId}`): PII strictly isolated to `canViewContacts()` for reads and `canManageContacts()` for writes.
  - `UserSettings` (`/userSettings/{userId}`): strictly isolated per user (`userId == request.auth.uid && existing().ownerId == request.auth.uid`).
  - `TravelTrip` (`/travelTrips/{tripId}`) & `TravelStop` (`/travelTrips/{tripId}/stops/{stopId}`):
    - Trips are readable by active authorized users; creation/deletion/editing requires `canManageWork()` (with Tier 1 Admin/Manager/Creator full edit and Tier 2 quick status/route summary sync).
    - Stops are stored as a scalable subcollection (Pillar 1 Master Gate) enforcing `tripExistsAfter(tripId)` on create and `tripExists(tripId)` on get/update/delete, plus strict relational foreign-key validation `locationExists(incoming().locationId)` and immutable `tripId`/`ownerId`/`createdAt`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Read**: Anonymous client attempts to list `/workItems`, `/travelTrips`, or `/appUsers` -> DENIED.
2. **Unregistered User Access**: Verified Google user `stranger@gmail.com` not present in `/appUsers` attempts to read `/locations/loc-1` -> DENIED.
3. **Unverified Email Spoof**: Token with `email: 'dinhlong.tran932@gmail.com'` and `email_verified: false` attempts to write `/appUsers/test@gmail.com` -> DENIED.
4. **Self Privilege Escalation**: Active `staff` user attempts to update their own `/appUsers/staff@gmail.com` setting `role: 'admin'` or `canManageContacts: true` -> DENIED.
5. **Non-Admin User Creation**: Active `manager` attempts to create `/appUsers/hacker@gmail.com` -> DENIED.
6. **Super Admin Deletion / Demotion**: Another `admin` attempts to delete `/appUsers/dinhlong.tran932@gmail.com` or set its `status: 'suspended'` / `role: 'viewer'` -> DENIED.
7. **Suspended User Access**: User in `/appUsers` with `status: 'suspended'` attempts to read `/workItems` or `/travelTrips` -> DENIED.
8. **Viewer Write Attempt**: Active `viewer` attempts to create or update `/workItems/wi-1`, `/locations/loc-1`, or `/travelTrips/trip-1` -> DENIED.
9. **PII Unauthorized Read**: Active `staff` or `viewer` with `canViewContacts: false` attempts to read or list `/contacts` -> DENIED.
10. **Shadow / Ghost Field Injection**: Admin creates `/appUsers/new@gmail.com` or `/travelTrips/trip-1` with extra field `superSecret: true` -> DENIED via `keys().hasOnly(...)`.
11. **Identity Spoofing & Immutable Mutation**: User creates `/workItems/wi-2` or `/travelTrips/trip-1/stops/stop-1` with `ownerId: 'other_uid'` or mismatched `tripId` -> DENIED.
12. **Orphaned Foreign Key & ID Poisoning**: User creates `/travelTrips/missing_trip/stops/stop-1` or `/workItems/wi-3` with non-existent `locationId` or 500-char ID -> DENIED via `isValidId()`, `tripExistsAfter()`, and `locationExists()`.
