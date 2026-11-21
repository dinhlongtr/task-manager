import React, { useMemo, useState } from 'react';
import {
  Edit3,
  Eye,
  EyeOff,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  CONTACT_GROUP_LABELS,
  maskSensitiveAddress,
  maskSensitiveEmail,
  maskSensitivePhone,
  type ContactGroup,
  type ContactRecord,
  type LocationRecord,
  type WorkItemRecord,
} from '../types';
import {
  createContact,
  deleteContact,
  updateContact,
} from '../services/firestoreService';

interface ContactsViewProps {
  ownerId: string;
  contacts: ContactRecord[];
  locations: LocationRecord[];
  workItems: WorkItemRecord[];
  locationsMap: Map<string, LocationRecord>;
  privacyMaskEnabled: boolean;
  canManageContacts: boolean;
  isManagerOrAdmin: boolean;
  onNotify: (msg: string) => void;
}

export const ContactsView: React.FC<ContactsViewProps> = ({
  ownerId,
  contacts,
  locations,
  workItems,
  locationsMap,
  privacyMaskEnabled,
  canManageContacts,
  isManagerOrAdmin,
  onNotify,
}) => {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<'all' | ContactGroup>('all');
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ContactRecord | null>(null);
  const [code, setCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [group, setGroup] = useState<ContactGroup>('client');
  const [relationship, setRelationship] = useState('');
  const [organization, setOrganization] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [locationId, setLocationId] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const workCountByContact = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of workItems) {
      if (w.contactId) {
        map.set(w.contactId, (map.get(w.contactId) || 0) + 1);
      }
    }
    return map;
  }, [workItems]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (groupFilter !== 'all' && c.group !== groupFilter) return false;
      if (!q) return true;
      return `${c.code} ${c.fullName} ${c.relationship} ${c.organization} ${c.phone} ${c.email} ${c.notes}`
        .toLowerCase()
        .includes(q);
    });
  }, [contacts, search, groupFilter]);

  const openCreate = () => {
    setEditing(null);
    setCode(`LH-${String(contacts.length + 1).padStart(3, '0')}`);
    setFullName('');
    setGroup('client');
    setRelationship('');
    setOrganization('');
    setPhone('');
    setEmail('');
    setLocationId('');
    setAddress('');
    setNotes('');
    setErrorMsg('');
    setModalOpen(true);
  };

  const openEdit = (ct: ContactRecord) => {
    setEditing(ct);
    setCode(ct.code);
    setFullName(ct.fullName);
    setGroup(ct.group);
    setRelationship(ct.relationship);
    setOrganization(ct.organization);
    setPhone(ct.phone);
    setEmail(ct.email);
    setLocationId(ct.locationId);
    setAddress(ct.address);
    setNotes(ct.notes);
    setErrorMsg('');
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErrorMsg('Vui lòng nhập họ và tên liên hệ.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        code: code.trim() || `LH-${String(Date.now()).slice(-3)}`,
        fullName: fullName.trim(),
        group,
        relationship: relationship.trim(),
        organization: organization.trim(),
        phone: phone.trim(),
        email: email.trim(),
        locationId,
        address: address.trim(),
        notes: notes.trim(),
      };
      if (editing) {
        await updateContact(editing.id, payload);
        onNotify(`Đã cập nhật liên hệ ${payload.fullName}`);
      } else {
        await createContact(ownerId, payload);
        onNotify(`Đã thêm liên hệ ${payload.fullName}`);
      }
      setModalOpen(false);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể lưu thông tin danh bạ.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ct: ContactRecord) => {
    await deleteContact(ct.id);
    setConfirmDeleteId(null);
    onNotify(`Đã xóa liên hệ ${ct.fullName}`);
  };

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Danh bạ & Mối quan hệ cá nhân
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Quản lý danh bạ khách hàng, người thân, đối tác và đồng nghiệp — bảo vệ dữ liệu nhạy cảm (PII) theo phân quyền.
          </p>
        </div>
        {canManageContacts && (
          <button
            type="button"
            onClick={openCreate}
            className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Thêm liên hệ
          </button>
        )}
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                ['all', 'Tất cả'],
                ['client', 'Khách hàng'],
                ['family', 'Người thân'],
                ['partner', 'Đối tác'],
                ['colleague', 'Đồng nghiệp'],
                ['other', 'Khác'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setGroupFilter(val)}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  groupFilter === val
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tên, SĐT, công ty, quan hệ..."
              className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>
        </div>
      </div>

      {/* Contact List */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm text-slate-600">Chưa có liên hệ nào phù hợp.</p>
          {canManageContacts && (
            <button
              type="button"
              onClick={openCreate}
              className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#1E3A5F] rounded-lg"
            >
              <Plus className="w-4 h-4" />
              Thêm liên hệ mới
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((ct) => {
            const loc = ct.locationId ? locationsMap.get(ct.locationId) : undefined;
            const linkedWork = workCountByContact.get(ct.id) || 0;
            const shouldMask = privacyMaskEnabled && !revealedIds[ct.id];

            return (
              <div
                key={ct.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                        <span className="font-mono-tabular font-semibold text-[#1E3A5F]">
                          {ct.code}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{CONTACT_GROUP_LABELS[ct.group]}</span>
                        {linkedWork > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{linkedWork} lịch</span>
                          </>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 mt-1 truncate">
                        {ct.fullName}
                      </h3>
                      {(ct.relationship || ct.organization) && (
                        <p className="text-xs text-slate-600 truncate">
                          {[ct.relationship, ct.organization].filter(Boolean).join(' — ')}
                        </p>
                      )}
                    </div>

                    {privacyMaskEnabled && (
                      <button
                        type="button"
                        onClick={() => toggleReveal(ct.id)}
                        aria-label={shouldMask ? 'Hiện thông tin nhạy cảm' : 'Ẩn thông tin'}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-800 rounded-lg"
                      >
                        {shouldMask ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 space-y-1.5 text-xs text-slate-700">
                    {ct.phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {shouldMask ? (
                          <span className="font-mono-tabular">
                            {maskSensitivePhone(ct.phone, true)}
                          </span>
                        ) : (
                          <a
                            href={`tel:${ct.phone}`}
                            className="font-mono-tabular text-[#1E3A5F] hover:underline"
                          >
                            {ct.phone}
                          </a>
                        )}
                      </div>
                    )}
                    {ct.email && (
                      <div className="flex items-center gap-2 min-w-0">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        {shouldMask ? (
                          <span className="truncate">{maskSensitiveEmail(ct.email, true)}</span>
                        ) : (
                          <a
                            href={`mailto:${ct.email}`}
                            className="text-slate-700 hover:text-[#1E3A5F] hover:underline truncate"
                          >
                            {ct.email}
                          </a>
                        )}
                      </div>
                    )}
                    {(loc || ct.address) && (
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span className="text-slate-600 leading-snug">
                          {loc
                            ? `${loc.code} · ${loc.name}`
                            : maskSensitiveAddress(ct.address, shouldMask)}
                        </span>
                      </div>
                    )}
                    {ct.notes && <p className="text-slate-500 pt-1 leading-relaxed">{ct.notes}</p>}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                  {ct.phone ? (
                    <a
                      href={`tel:${ct.phone}`}
                      className="min-h-[36px] inline-flex items-center font-medium text-[#1E3A5F] hover:underline"
                    >
                      Gọi nhanh
                    </a>
                  ) : (
                    <span />
                  )}

                  {canManageContacts && (isManagerOrAdmin || ct.ownerId === ownerId) && (
                    confirmDeleteId === ct.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDelete(ct)}
                          className="px-2.5 py-1 font-semibold text-white bg-red-600 rounded"
                        >
                          Xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-slate-600"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(ct)}
                          aria-label="Sửa liên hệ"
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-500 hover:text-[#1E3A5F] rounded-lg"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(ct.id)}
                          aria-label="Xóa liên hệ"
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-500 hover:text-red-700 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Contact Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-0 sm:p-4">
          <div className="w-full sm:max-w-xl bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                {editing ? 'Chỉnh sửa liên hệ' : 'Thêm liên hệ mới'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Mã liên hệ</label>
                  <input
                    type="text"
                    required
                    maxLength={32}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Họ và tên *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="VD: Nguyễn Minh Quân"
                    className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Nhóm quan hệ</label>
                  <select
                    value={group}
                    onChange={(e) => setGroup(e.target.value as ContactGroup)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    {(Object.keys(CONTACT_GROUP_LABELS) as ContactGroup[]).map((g) => (
                      <option key={g} value={g}>
                        {CONTACT_GROUP_LABELS[g]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Chức vụ / Mối quan hệ cụ thể
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    placeholder="VD: Giám đốc, Anh trai, Trưởng phòng..."
                    className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Cơ quan / Công ty
                </label>
                <input
                  type="text"
                  maxLength={160}
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Tên cơ quan, doanh nghiệp..."
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="tel"
                    maxLength={32}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="090..."
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono-tabular border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    maxLength={160}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ten@congty.vn"
                    className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Địa điểm liên kết (tùy chọn)
                </label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- Không chọn địa điểm từ bảng --</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      [{loc.code}] {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Địa chỉ riêng (nếu khác địa điểm trên)
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ghi chú cá nhân (ngày sinh, lưu ý làm việc)
                </label>
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] px-5 py-2 text-sm font-medium text-white bg-[#1E3A5F] rounded-lg hover:bg-[#162C49] disabled:opacity-50"
                >
                  {saving ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Lưu liên hệ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
