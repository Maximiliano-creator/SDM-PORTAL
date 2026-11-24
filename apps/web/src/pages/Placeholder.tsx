import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Esta sección se implementa en {phase}.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Cuando llegue el momento, esta página consumirá los endpoints documentados en{' '}
          <code>C:\sdm\API.md</code>.
        </p>
      </CardContent>
    </Card>
  );
}
