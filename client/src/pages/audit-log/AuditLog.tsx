import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';

interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId?: string;
  description?: string;
  metadata?: any;
  user: {
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string;
}

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => { fetchLogs(); }, [page, action, entity, userId]);
  useEffect(() => { api.get('/users').then(r => setUsers(r.data.data?.users || [])).catch(() => {}); }, []);

  const fetchLogs = async () => {
    try {
      const response = await api.get('/audit-logs', { params: { page, limit: 20, action: action || undefined, entity: entity || undefined, userId: userId || undefined } });
      if (response.data.success) {
        setLogs(response.data.data?.logs || []);
        setTotalPages(response.data.data?.pagination?.totalPages || 1);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500 dark:text-gray-400">Loading audit logs...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audit Log</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Track important system activity</p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <Card>
        <div className="p-4 border-b border-orange-100 dark:border-gray-700 flex flex-wrap gap-3">
          <select value={action} onChange={e=>{setPage(1);setAction(e.target.value)}} className="h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 px-3 text-sm"><option value="">All actions</option>{['CREATE','UPDATE','DELETE','LOGIN','LOGOUT','PASSWORD_CHANGE','PASSWORD_RESET'].map(a=><option key={a}>{a}</option>)}</select>
          <select value={entity} onChange={e=>{setPage(1);setEntity(e.target.value)}} className="h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 px-3 text-sm"><option value="">All entities</option>{['User','Role','Payment','Sale','Inventory','Reservation'].map(x=><option key={x}>{x}</option>)}</select>
          <select value={userId} onChange={e=>{setPage(1);setUserId(e.target.value)}} className="h-9 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] text-gray-900 dark:text-gray-100 px-3 text-sm"><option value="">All users</option>{users.map(u=><option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select>
          {(action||entity||userId)&&<Button size="sm" variant="secondary" onClick={()=>{setAction('');setEntity('');setUserId('');setPage(1)}}>Clear filters</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-[#faf9f7] dark:bg-[#111116]/70">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Entity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#111116] divide-y divide-gray-200 dark:divide-gray-700">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-[#faf9f7] dark:hover:bg-[#1a1a20]/30">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <Badge>{log.action}</Badge>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">{log.entity}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">{log.description || '-'}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No audit logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-orange-100 dark:border-gray-700">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
