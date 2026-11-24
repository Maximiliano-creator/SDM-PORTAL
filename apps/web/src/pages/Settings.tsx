import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/queryClient';

interface FormValues {
  'term_admin.url': string;
  'term_admin.username': string;
  'term_admin.password': string;
  'branding.app_name': string;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await apiClient.settings();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const form = useForm<FormValues>({
    values: {
      'term_admin.url': settingsQuery.data?.['term_admin.url'] ?? '',
      'term_admin.username': settingsQuery.data?.['term_admin.username'] ?? '',
      'term_admin.password': settingsQuery.data?.['term_admin.password'] ?? '',
      'branding.app_name': settingsQuery.data?.['branding.app_name'] ?? 'SDM Portal',
    },
  });

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload: Partial<FormValues> = {};
      // No mandar password si quedó como bullets (no la cambió)
      for (const [k, v] of Object.entries(values) as [keyof FormValues, string][]) {
        if (k === 'term_admin.password' && v === '••••••••') continue;
        payload[k] = v;
      }
      const r = await apiClient.saveSettings(payload);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      toast.success(`Configuración guardada (${data.changed.length} campos)`);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['health'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const r = await apiClient.testUpstream();
    setTesting(false);
    if (!r.ok) {
      setTestResult({ ok: false, msg: r.error.message });
      return;
    }
    if (r.data.reachable) {
      setTestResult({ ok: true, msg: `Conectado a term_admin ${r.data.version ?? ''}` });
    } else {
      setTestResult({ ok: false, msg: r.data.error ?? 'No responde' });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Configuración</h2>
        <p className="text-sm text-muted-foreground">
          Conexión al backend BLS <code>term_admin</code> y datos de marca.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backend BLS (term_admin)</CardTitle>
          <CardDescription>
            URL y credenciales para que tu portal consulte la API del backend.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input id="url" {...form.register('term_admin.url')} placeholder="http://localhost:19697" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="user">Usuario BLS</Label>
                <Input id="user" {...form.register('term_admin.username')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pwd">Contraseña BLS</Label>
                <Input id="pwd" type="password" {...form.register('term_admin.password')} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Guardando…' : 'Guardar'}
              </Button>
              <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                {testing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" /> Probando
                  </>
                ) : (
                  'Probar conexión'
                )}
              </Button>
              {testResult && (
                <Badge variant={testResult.ok ? 'success' : 'destructive'} className="gap-1">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  {testResult.msg}
                </Badge>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Marca</CardTitle>
          <CardDescription>Nombre visible de la app (white-label).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="appname">Nombre de la app</Label>
            <Input id="appname" {...form.register('branding.app_name')} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
