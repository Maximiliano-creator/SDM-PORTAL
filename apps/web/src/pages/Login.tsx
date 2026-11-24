import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@sdm/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const brandingQuery = useQuery({
    queryKey: ['branding'],
    queryFn: async () => {
      const r = await apiClient.branding();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });
  const appName = brandingQuery.data?.appName ?? 'SDM Portal';

  useEffect(() => {
    document.title = appName;
  }, [appName]);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { username: '', password: '' },
  });

  async function onSubmit(values: LoginRequest) {
    setLoading(true);
    const res = await apiClient.login(values);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setSession(res.data);
    toast.success(`Bienvenido, ${res.data.user.fullName ?? res.data.user.username}`);
    navigate('/', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{appName}</CardTitle>
          <CardDescription>Iniciá sesión para administrar tus balanzas.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                autoComplete="username"
                {...form.register('username')}
                disabled={loading}
              />
              {form.formState.errors.username && (
                <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
                disabled={loading}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Verificando…' : 'Ingresar'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Default tras instalación: <strong>admin</strong> / <strong>admin</strong>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
