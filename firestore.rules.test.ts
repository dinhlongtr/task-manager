/**
 * Firestore Security Rules TDD Specification ("Dirty Dozen" Multi-User RBAC Test Suite)
 * Verifies every adversarial payload returns PERMISSION_DENIED under firestore.rules.
 */

export interface AdversarialCase {
  id: number;
  name: string;
  actor: {
    uid: string | null;
    email: string | null;
    emailVerified: boolean;
    appUserRole?: 'admin' | 'manager' | 'staff' | 'viewer';
    appUserStatus?: 'active' | 'suspended';
    canViewContacts?: boolean;
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: AdversarialCase[] = [
  {
    id: 1,
    name: 'Unauthenticated list on /appUsers',
    actor: { uid: null, email: null, emailVerified: false },
    operation: 'list',
    path: '/appUsers',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unregistered verified Google user attempting to read /locations/loc_1',
    actor: { uid: 'uid_stranger', email: 'stranger@gmail.com', emailVerified: true },
    operation: 'get',
    path: '/locations/loc_1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified email spoofing Super Admin email',
    actor: { uid: 'uid_spoof', email: 'dinhlong.tran932@gmail.com', emailVerified: false },
    operation: 'create',
    path: '/appUsers/fake@gmail.com',
    payload: { email: 'fake@gmail.com', role: 'admin', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Staff user attempting self-privilege escalation to admin',
    actor: {
      uid: 'uid_staff',
      email: 'staff@gmail.com',
      emailVerified: true,
      appUserRole: 'staff',
      appUserStatus: 'active',
    },
    operation: 'update',
    path: '/appUsers/staff@gmail.com',
    payload: { role: 'admin', canManageContacts: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Manager attempting to add a new user in /appUsers',
    actor: {
      uid: 'uid_mgr',
      email: 'manager@gmail.com',
      emailVerified: true,
      appUserRole: 'manager',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/appUsers/newuser@gmail.com',
    payload: { email: 'newuser@gmail.com', role: 'staff', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Secondary admin attempting to delete Super Admin account',
    actor: {
      uid: 'uid_admin2',
      email: 'admin2@gmail.com',
      emailVerified: true,
      appUserRole: 'admin',
      appUserStatus: 'active',
    },
    operation: 'delete',
    path: '/appUsers/dinhlong.tran932@gmail.com',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Suspended user attempting to list /workItems',
    actor: {
      uid: 'uid_susp',
      email: 'suspended@gmail.com',
      emailVerified: true,
      appUserRole: 'manager',
      appUserStatus: 'suspended',
    },
    operation: 'list',
    path: '/workItems',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Viewer attempting to create a workItem',
    actor: {
      uid: 'uid_view',
      email: 'viewer@gmail.com',
      emailVerified: true,
      appUserRole: 'viewer',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/workItems/wi_bad',
    payload: { ownerId: 'uid_view', title: 'Unauthorized write' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Staff without canViewContacts attempting to read PII /contacts/ct_1',
    actor: {
      uid: 'uid_staff',
      email: 'staff@gmail.com',
      emailVerified: true,
      appUserRole: 'staff',
      appUserStatus: 'active',
      canViewContacts: false,
    },
    operation: 'get',
    path: '/contacts/ct_1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Shadow field injection on /appUsers create',
    actor: {
      uid: 'uid_owner',
      email: 'dinhlong.tran932@gmail.com',
      emailVerified: true,
      appUserRole: 'admin',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/appUsers/ghost@gmail.com',
    payload: { email: 'ghost@gmail.com', ghostFlag: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Identity spoofing: setting ownerId to another UID on /locations create',
    actor: {
      uid: 'uid_mgr',
      email: 'manager@gmail.com',
      emailVerified: true,
      appUserRole: 'manager',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/locations/loc_spoof',
    payload: { ownerId: 'uid_victim', code: 'DD-99', name: 'Spoof', address: 'X' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Orphaned foreign key & ID poisoning on /workItems create',
    actor: {
      uid: 'uid_owner',
      email: 'dinhlong.tran932@gmail.com',
      emailVerified: true,
      appUserRole: 'admin',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/workItems/invalid..id..poison',
    payload: { ownerId: 'uid_owner', locationId: 'non_existent_loc' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Orphaned travel stop referencing non-existent parent trip or location',
    actor: {
      uid: 'uid_owner',
      email: 'dinhlong.tran932@gmail.com',
      emailVerified: true,
      appUserRole: 'admin',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/travelTrips/missing_trip/stops/stop_1',
    payload: { ownerId: 'uid_owner', tripId: 'missing_trip', locationId: 'non_existent_loc' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Viewer attempting to create a travel trip',
    actor: {
      uid: 'uid_view',
      email: 'viewer@gmail.com',
      emailVerified: true,
      appUserRole: 'viewer',
      appUserStatus: 'active',
    },
    operation: 'create',
    path: '/travelTrips/trip_bad',
    payload: { ownerId: 'uid_view', code: 'DL-BAD', title: 'Unauthorized trip' },
    expected: 'PERMISSION_DENIED',
  },
];
