import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Scale as ScaleIcon,
  Send,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Scale } from '@sdm/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';
import { parseExcel, type ImportRow } from '@/lib/excel';
import { useAuthStore } from '@/store/auth';

const DATA_TYPES: { id: 0 | 1 | 2; label: string; description: string }[] = [
  { id: 0, label: 'Enviar Productos', description: 'Catálogo de PLUs, nombres, precios, unidades y departamentos' },
  { id: 1, label: 'Enviar Mensajes / Agrupación', description: 'Departamentos, grupos de PLU y textos de balanza' },
  { id: 2, label: 'Enviar Imágenes', description: 'Imágenes asociadas a productos / botones' },
];

export interface UploadedImageFile {
  id: string;
  file: File;
  name: string;
  previewUrl: string;
  matchedPlu?: string;
}

const MAX_IMPORT_PRODUCTS = 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BATCH_CHARS = 9 * 1024 * 1024;
const MAX_IMAGE_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BATCH_ITEMS = 25;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`No se pudo leer ${file.name}.`));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/[^a-z0-9]/g, '') // Solo alfanuméricos
    .trim();
}

function matchImageToPlu(filename: string, rows: ImportRow[]): string | undefined {
  const base = filename.replace(/\.[^/.]+$/, '');
  const normBase = normalizeForMatching(base);
  if (!normBase || rows.length === 0) return undefined;

  // 1. Coincidencia exacta con PLU: ej. "1.png" -> PLU "1"
  const matchPlu = rows.find((r) => normalizeForMatching(r.goodsPlu) === normBase);
  if (matchPlu) return matchPlu.goodsPlu;

  // 2. Coincidencia exacta con Nombre del Producto: ej. "PLATANO.jpg" -> "PLATANO"
  const matchName = rows.find((r) => normalizeForMatching(r.goodsName) === normBase);
  if (matchName) return matchName.goodsPlu;

  // 3. Coincidencia combinada PLU + Nombre: ej. "1_PLATANO.png", "PLU 1 PLATANO.jpg", "1-platano.png"
  for (const r of rows) {
    const normP = normalizeForMatching(r.goodsPlu);
    const normN = normalizeForMatching(r.goodsName);
    if (
      normBase === `${normP}${normN}` ||
      normBase === `plu${normP}${normN}` ||
      normBase === `${normN}${normP}`
    ) {
      return r.goodsPlu;
    }
    if (normBase.includes(normN) && (normBase.startsWith(normP) || normBase.endsWith(normP))) {
      return r.goodsPlu;
    }
  }

  // 4. Inclusión de nombre: ej. "foto_platano_chile.jpg" -> "platano"
  const containsName = rows.find(
    (r) => normBase.includes(normalizeForMatching(r.goodsName)) && normalizeForMatching(r.goodsName).length >= 3,
  );
  if (containsName) return containsName.goodsPlu;

  return undefined;
}

export function CatalogImportPage() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const fileRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [imageDragActive, setImageDragActive] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [shopCode, setShopCode] = useState<string>('');
  const [mode] = useState<'incremental' | 'full'>('incremental');

  // Estado para imágenes cargadas y vinculadas
  const [images, setImages] = useState<UploadedImageFile[]>([]);

  // Estado para el envío directo a balanza
  const [distShopFilter, setDistShopFilter] = useState<string>('');
  const [selectedTermIds, setSelectedTermIds] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<(0 | 1 | 2)[]>([0, 1, 2]);
  const [showSendModal, setShowSendModal] = useState(false);

  const shopsQuery = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const scalesQuery = useQuery({
    queryKey: ['scales'],
    queryFn: async () => {
      const r = await apiClient.scales();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const availableScales = useMemo(() => {
    const all = scalesQuery.data ?? [];
    if (!distShopFilter) return all;
    return all.filter((sc: Scale) => sc.shopId === Number(distShopFilter));
  }, [scalesQuery.data, distShopFilter]);

  function toggleScale(termId: number) {
    setSelectedTermIds((prev) =>
      prev.includes(termId) ? prev.filter((id) => id !== termId) : [...prev, termId],
    );
  }

  function toggleAllScales() {
    if (availableScales.length === 0) return;
    const allIds = availableScales.map((s) => s.termId);
    const allSelected = allIds.every((id) => selectedTermIds.includes(id));
    setSelectedTermIds(allSelected ? [] : allIds);
  }

  function toggleType(typeId: 0 | 1 | 2) {
    setSelectedTypes((prev) => {
      if (typeId === 1 && prev.includes(0)) return prev;
      if (prev.includes(typeId)) return prev.filter((t) => t !== typeId);
      return typeId === 0 && !prev.includes(1) ? [...prev, typeId, 1] : [...prev, typeId];
    });
  }

  // Mapa de PLU a imagen vinculada
  const pluToImageMap = useMemo(() => {
    const map = new Map<string, UploadedImageFile>();
    for (const img of images) {
      if (img.matchedPlu) {
        map.set(img.matchedPlu, img);
      }
    }
    return map;
  }, [images]);

  async function handleFile(file: File) {
    try {
      const result = await parseExcel(file);
      if (result.rows.length > MAX_IMPORT_PRODUCTS) {
        throw new Error(`El archivo supera el límite de ${MAX_IMPORT_PRODUCTS} productos por importación.`);
      }
      setRows(result.rows);
      setWarnings(result.warnings);
      setUnknown(result.unknownHeaders);
      if (result.rows.length === 0) {
        toast.error('No se encontraron filas válidas en el archivo.');
      } else {
        toast.success(
          `${result.rows.length} fila(s) leída(s)${result.warnings.length > 0 ? ` con ${result.warnings.length} advertencia(s)` : ''}`,
        );
        // Si ya hay imágenes subidas, intentar re-vincularlas
        if (images.length > 0) {
          recalculateMatches(images, result.rows);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo leer el archivo');
    }
  }

  async function handleImageFiles(files: FileList | File[]) {
    const selectedFiles = Array.from(files).filter((f) =>
      /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name),
    );
    if (selectedFiles.length === 0) {
      toast.error('No se seleccionaron archivos de imagen válidos (.jpg, .png, .webp).');
      return;
    }

    const oversizedFiles = selectedFiles.filter((file) => file.size > MAX_IMAGE_BYTES);
    if (oversizedFiles.length > 0) {
      toast.error(`Cada imagen debe pesar 5 MB o menos. Revisa: ${oversizedFiles[0]?.name}`);
      return;
    }

    const prospectiveNames = new Set(images.map((image) => image.name));
    selectedFiles.forEach((file) => prospectiveNames.add(file.name));
    if (prospectiveNames.size > MAX_IMPORT_PRODUCTS) {
      toast.error(`Se admite un máximo de ${MAX_IMPORT_PRODUCTS} imágenes por importación.`);
      return;
    }

    const processed: UploadedImageFile[] = [];

    for (const file of selectedFiles) {
      const id = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      const matchedPlu = matchImageToPlu(file.name, rows);

      processed.push({
        id,
        file,
        name: file.name,
        previewUrl,
        matchedPlu,
      });
    }

    setImages((prev) => {
      // Combinar evitando duplicados por nombre
      const combined = [...prev];
      for (const p of processed) {
        const idx = combined.findIndex((c) => c.name === p.name);
        if (idx >= 0) combined[idx] = p;
        else combined.push(p);
      }
      return combined;
    });

    const matchedCount = processed.filter((p) => p.matchedPlu).length;
    if (matchedCount > 0) {
      toast.success(
        `${processed.length} imagen(es) procesada(s) · ${matchedCount} vinculada(s) automáticamente por nombre o PLU.`,
      );
    } else {
      toast.info(
        `${processed.length} imagen(es) procesada(s). Puedes asociarlas a los PLUs abajo.`,
      );
    }
  }

  function recalculateMatches(currentImages: UploadedImageFile[], currentRows: ImportRow[]) {
    const updated = currentImages.map((img) => ({
      ...img,
      matchedPlu: img.matchedPlu ?? matchImageToPlu(img.name, currentRows),
    }));
    setImages(updated);
  }

  function setManualMatch(imageId: string, plu: string) {
    setImages((prev) =>
      prev.map((img) => (img.id === imageId ? { ...img, matchedPlu: plu || undefined } : img)),
    );
  }

  function unlinkImage(plu: string) {
    setImages((prev) =>
      prev.map((img) => (img.matchedPlu === plu ? { ...img, matchedPlu: undefined } : img)),
    );
  }

  function removeImage(imageId: string) {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  }

  const importMut = useMutation({
    mutationFn: async () => {
      if (!shopCode) throw new Error('Seleccioná una tienda de destino');
      if (rows.length === 0) throw new Error('No hay filas para importar');

      // 1. Si hay imágenes vinculadas a los PLUs, subirlas primero al servidor
      const imagesToUpload = images.filter((img) => img.matchedPlu);
      const uploadedMap = new Map<string, string>(); // plu -> serverUrl

      if (imagesToUpload.length > 0) {
        const batches: UploadedImageFile[][] = [];
        let currentBatch: UploadedImageFile[] = [];
        let currentChars = 0;
        let currentBytes = 0;
        for (const image of imagesToUpload) {
          const encodedChars = 4 * Math.ceil(image.file.size / 3) + 64;
          if (
            currentBatch.length > 0 &&
            (currentBatch.length >= MAX_IMAGE_BATCH_ITEMS ||
              currentChars + encodedChars > MAX_IMAGE_BATCH_CHARS ||
              currentBytes + image.file.size > MAX_IMAGE_BATCH_BYTES)
          ) {
            batches.push(currentBatch);
            currentBatch = [];
            currentChars = 0;
            currentBytes = 0;
          }
          currentBatch.push(image);
          currentChars += encodedChars;
          currentBytes += image.file.size;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);

        for (let index = 0; index < batches.length; index++) {
          const batch = batches[index]!;
          toast.loading(
            `Subiendo imágenes: lote ${index + 1} de ${batches.length}...`,
            { id: 'import-progress' },
          );
          const uploadRes = await apiClient.uploadImages(
            await Promise.all(
              batch.map(async (image) => ({
                name: image.name,
                data: await readAsDataUrl(image.file),
                size: image.file.size,
              })),
            ),
          );
          if (!uploadRes.ok) {
            throw new Error(`Error al subir imágenes: ${uploadRes.error.message}`);
          }

          for (const uploadedItem of uploadRes.data.items) {
            const matchedImg = batch.find((image) => image.name === uploadedItem.originalName);
            if (matchedImg?.matchedPlu) {
              uploadedMap.set(matchedImg.matchedPlu, uploadedItem.url);
            }
          }
        }
      }

      toast.loading('Importando productos al catálogo...', { id: 'import-progress' });

      // 2. Asociar el imagePath a cada item
      const items = rows.map((r) => {
        const serverImageUrl = uploadedMap.get(r.goodsPlu);
        return {
          ...r,
          shopCode: r.shopCode ?? shopCode,
          imagePath: serverImageUrl ?? r.imagePath ?? '',
        };
      });

      const res = await apiClient.importProducts({ shopCode, mode, items });
      if (!res.ok) throw new Error(res.error.message);
      return { importData: res.data, uploadedImagesCount: uploadedMap.size };
    },
    onSuccess: ({ importData, uploadedImagesCount }) => {
      toast.dismiss('import-progress');
      const parts = [`${importData.created} producto(s) añadido(s)`];
      if (uploadedImagesCount > 0) parts.push(`${uploadedImagesCount} imagen(es) vinculada(s)`);
      if (importData.skippedExisting > 0) parts.push(`${importData.skippedExisting} existente(s) omitido(s)`);
      if (importData.skippedDuplicate > 0) parts.push(`${importData.skippedDuplicate} duplicado(s) omitido(s)`);
      if (importData.failed > 0) parts.push(`${importData.failed} fallaron`);
      const grouping = importData.grouping;
      if (grouping.groupsCreated > 0) parts.push(`${grouping.groupsCreated} departamento(s) creado(s)`);
      if (grouping.associated > 0) parts.push(`${grouping.associated} PLU(s) procesado(s) para agrupación`);
      if (grouping.failed > 0) parts.push(`${grouping.failed} PLU(s) no pudieron agruparse`);

      const msg = `Importación completada: ${parts.join(' · ')}`;
      if (importData.failed > 0 || grouping.failed > 0) toast.warning(msg);
      else toast.success(msg);

      if (importData.failed === 0 && grouping.failed === 0 && importData.created > 0) {
        setTimeout(() => navigate('/catalogo'), 1800);
      }
    },
    onError: (e: Error) => {
      toast.dismiss('import-progress');
      toast.error(e.message);
    },
  });

  const distributeMut = useMutation({
    mutationFn: async () => {
      if (selectedTermIds.length === 0) throw new Error('Seleccioná al menos una balanza');
      if (selectedTypes.length === 0) throw new Error('Seleccioná al menos qué información enviar');
      const res = await apiClient.distributeScaleData({
        shopId: -1,
        targetTermIdList: selectedTermIds,
        typeList: selectedTypes,
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      const labels = DATA_TYPES.filter((t) => data.typeList.includes(t.id)).map((t) => t.label);
      toast.success(
        `Envío gatillado a ${data.targetTermIdList.length} balanza(s): ${labels.join(', ')}`,
      );
      setShowSendModal(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unmatchedImages = images.filter((img) => !img.matchedPlu);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/catalogo">
            <ArrowLeft className="h-4 w-4" /> Volver al catálogo
          </Link>
        </Button>

        {isAdmin && <Button
          variant="default"
          onClick={() => {
            if (selectedTermIds.length === 0 && availableScales.length === 1 && availableScales[0]) {
              setSelectedTermIds([availableScales[0].termId]);
            }
            setShowSendModal(true);
          }}
        >
          <Send className="h-4 w-4" /> Enviar Datos a Balanza
        </Button>}
      </div>

      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Carga Masiva de Catálogo e Imágenes</h2>
        <p className="text-sm text-muted-foreground">
          Carga productos desde Excel, vincula automáticamente imágenes por nombre de PLU (ej. PLATANO.JPG $\rightarrow$ PLU 1 PLATANO) y sincroniza hacia las balanzas.
        </p>
      </div>

      {isAdmin && <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <ScaleIcon className="h-4 w-4" /> Envío directo de datos a balanzas
            </CardTitle>
            <CardDescription>
              Selecciona las balanzas destino y los paquetes. Al enviar PLUs también se enviará Agrupación/Mensajes para incluir sus departamentos y grupos.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-xs"
              value={distShopFilter}
              onChange={(e) => {
                setDistShopFilter(e.target.value);
                setSelectedTermIds([]);
              }}
            >
              <option value="">Todas las tiendas</option>
              {(shopsQuery.data ?? []).map((s) => (
                <option key={s.shopId} value={s.shopId}>
                  {s.shopName}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => scalesQuery.refetch()}
              disabled={scalesQuery.isFetching}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las balanzas"
                    checked={
                      availableScales.length > 0 &&
                      availableScales.every((s) => selectedTermIds.includes(s.termId))
                    }
                    onChange={toggleAllScales}
                  />
                </TableHead>
                <TableHead>Dispositivo</TableHead>
                <TableHead>Tienda</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>IP / Serie</TableHead>
                <TableHead>Última sinc. productos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {availableScales.length === 0 && !scalesQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                    No hay balanzas disponibles para el filtro seleccionado.
                  </TableCell>
                </TableRow>
              )}
              {availableScales.map((sc: Scale) => {
                const checked = selectedTermIds.includes(sc.termId);
                const online = sc.onlineStatus === 1;
                return (
                  <TableRow
                    key={sc.termId}
                    className="cursor-pointer"
                    onClick={() => toggleScale(sc.termId)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleScale(sc.termId)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {sc.termName}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        #{sc.termId}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{sc.shopName ?? `Tienda ${sc.shopId}`}</TableCell>
                    <TableCell>
                      {online ? (
                        <Badge variant="success">En línea</Badge>
                      ) : (
                        <Badge variant="outline">Desconectada</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div>{sc.ipAddress}</div>
                      {sc.boardSn && (
                        <div className="text-muted-foreground">SN: {sc.boardSn}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {sc.lastSyncTermGoodsTime ?? '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs text-muted-foreground">
              {selectedTermIds.length} balanza(s) seleccionada(s)
            </span>
            <Button
              disabled={selectedTermIds.length === 0}
              onClick={() => setShowSendModal(true)}
            >
              <Send className="h-4 w-4" /> Configurar y Enviar Datos ({selectedTermIds.length})
            </Button>
          </div>
        </CardContent>
      </Card>}

      {/* Modal de selección de paquetes a enviar */}
      {isAdmin && showSendModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !distributeMut.isPending && setShowSendModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-semibold">Seleccionar información a enviar</h3>
                <p className="text-xs text-muted-foreground">
                  Destino: {selectedTermIds.length} balanza(s) seleccionada(s)
                </p>
              </div>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => !distributeMut.isPending && setShowSendModal(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {DATA_TYPES.map((item) => {
                const active = selectedTypes.includes(item.id);
                const requiredForProducts = item.id === 1 && selectedTypes.includes(0);
                return (
                  <label
                    key={item.id}
                    className={`flex items-start gap-3 rounded-md border p-3 transition-colors ${
                      requiredForProducts ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'
                    } ${
                      active ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={active}
                      disabled={requiredForProducts}
                      onChange={() => toggleType(item.id)}
                    />
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.description}</div>
                      {requiredForProducts && (
                        <div className="text-[11px] text-primary">
                          Se incluye automáticamente al enviar PLUs.
                        </div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="outline"
                disabled={distributeMut.isPending}
                onClick={() => setShowSendModal(false)}
              >
                Cancelar
              </Button>
              <Button
                disabled={
                  distributeMut.isPending ||
                  selectedTermIds.length === 0 ||
                  selectedTypes.length === 0
                }
                onClick={() => distributeMut.mutate()}
              >
                <CheckCircle2 className="h-4 w-4" />
                {distributeMut.isPending ? 'Enviando…' : 'Confirmar envío'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Zonas de Carga: Excel e Imágenes */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Zona Excel */}
        <Card
          className={dragActive ? 'border-primary border-2' : 'border-dashed border-2'}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragActive(false);
            const f = e.dataTransfer.files[0];
            if (f) await handleFile(f);
          }}
        >
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">1. Cargar archivo Excel (.xlsx)</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Arrastra tu archivo con columnas PLU, Nombre y Precio
            </p>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              Seleccionar Excel
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) await handleFile(f);
              }}
            />
          </CardContent>
        </Card>

        {/* Zona Imágenes */}
        <Card
          className={imageDragActive ? 'border-primary border-2' : 'border-dashed border-2'}
          onDragEnter={(e) => {
            e.preventDefault();
            setImageDragActive(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setImageDragActive(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setImageDragActive(false);
            if (e.dataTransfer.files?.length) {
              await handleImageFiles(e.dataTransfer.files);
            }
          }}
        >
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <ImageIcon className="h-10 w-10 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">2. Subir Imágenes de Productos</p>
            <p className="mb-3 text-xs text-muted-foreground">
              Hasta 1.000 imágenes, máximo 5 MB cada una. Se cargan en lotes acotados.
              Ejemplos: <code>PLATANO.JPG</code>, <code>1.png</code>.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => imageInputRef.current?.click()}
              >
                Seleccionar Imágenes
              </Button>
              {images.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setImages([])}>
                  Limpiar ({images.length})
                </Button>
              )}
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                if (e.target.files?.length) {
                  await handleImageFiles(e.target.files);
                }
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Resumen de vinculación de imágenes si se cargaron */}
      {images.length > 0 && (
        <Card className="border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20">
          <CardHeader className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">
                  Vinculación de imágenes: {images.filter((i) => i.matchedPlu).length} de {images.length} asociadas a un PLU
                </CardTitle>
              </div>
              <Badge variant="outline" className="text-xs">
                {unmatchedImages.length === 0 ? 'Todas vinculadas' : `${unmatchedImages.length} sin asociar`}
              </Badge>
            </div>
          </CardHeader>
          {unmatchedImages.length > 0 && rows.length > 0 && (
            <CardContent className="py-2 space-y-2 border-t text-xs">
              <p className="font-medium text-muted-foreground">
                Imágenes pendientes de asignación manual:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {unmatchedImages.map((img) => (
                  <div
                    key={img.id}
                    className="flex items-center gap-2 p-2 rounded border bg-background"
                  >
                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="h-9 w-9 rounded object-cover border"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-mono text-[11px]" title={img.name}>
                        {img.name}
                      </div>
                      <select
                        className="h-7 w-full rounded border bg-background px-1 text-[11px]"
                        value={img.matchedPlu ?? ''}
                        onChange={(e) => setManualMatch(img.id, e.target.value)}
                      >
                        <option value="">Vincular a PLU…</option>
                        {rows.map((r) => (
                          <option key={r.goodsPlu} value={r.goodsPlu}>
                            PLU {r.goodsPlu} - {r.goodsName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="text-muted-foreground hover:text-destructive p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Previsualización de filas de Excel con miniaturas vinculadas */}
      {rows.length > 0 && (
        <>
          {warnings.length > 0 && (
            <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Advertencias ({warnings.length})</CardTitle>
              </CardHeader>
              <CardContent className="max-h-40 overflow-y-auto text-xs">
                {warnings.slice(0, 20).map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
                {warnings.length > 20 && (
                  <div className="text-muted-foreground">
                    … y {warnings.length - 20} más
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {unknown.length > 0 && (
            <Card>
              <CardContent className="text-xs">
                Columnas ignoradas (no reconocidas): <strong>{unknown.join(', ')}</strong>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base">Preview de productos ({rows.length} filas)</CardTitle>
                <CardDescription>
                  Verifica PLUs, nombres, departamentos e imágenes antes de confirmar.
                </CardDescription>
              </div>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Imagen</TableHead>
                  <TableHead>PLU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead>Departamento</TableHead>
                  <TableHead>Estado Imagen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 15).map((r, i) => {
                  const matchedImg = pluToImageMap.get(r.goodsPlu);
                  return (
                    <TableRow key={i}>
                      <TableCell>
                        {matchedImg ? (
                          <img
                            src={matchedImg.previewUrl}
                            alt={r.goodsName}
                            loading="lazy"
                            className="h-10 w-10 rounded border object-cover shadow-sm"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded border border-dashed flex items-center justify-center bg-muted/40 text-muted-foreground">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{r.goodsPlu}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.goodsName}</div>
                        {matchedImg && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[200px]">
                            {matchedImg.name}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{r.price ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {r.priceModel === 1 ? 'Conteo' : 'Peso'}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.unitName ?? '—'}</TableCell>
                      <TableCell>{r.deptCode || '—'}</TableCell>
                      <TableCell>
                        {matchedImg ? (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="success" className="text-[11px]">
                              Vinculada
                            </Badge>
                            <button
                              type="button"
                              onClick={() => unlinkImage(r.goodsPlu)}
                              className="text-xs text-muted-foreground hover:text-destructive underline"
                              title="Desvincular imagen"
                            >
                              Quitar
                            </button>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-[11px] text-muted-foreground">
                            Sin imagen
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length > 15 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-3">
                      … y {rows.length - 15} productos más en este archivo
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Destino de importación y confirmación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tienda destino</label>
                <select
                  className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
                  value={shopCode}
                  onChange={(e) => setShopCode(e.target.value)}
                >
                  <option value="">Elegí una tienda…</option>
                  {(shopsQuery.data ?? []).map((s) => (
                    <option key={s.shopId} value={s.shopCode}>
                      {s.shopName} ({s.shopCode})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-md border border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20 p-3 text-xs text-muted-foreground">
                <strong>Validación de carga masiva activa:</strong> solo se añadirán productos cuyo PLU sea nuevo en la tienda. Los PLUs existentes y duplicados no se actualizarán; si tienen departamento, también se asociarán al grupo correspondiente. Los grupos faltantes se crearán automáticamente. Las asociaciones previas con otros grupos se conservan; las imágenes vinculadas se subirán y asignarán al producto.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => importMut.mutate()}
                  disabled={importMut.isPending || !shopCode || rows.length === 0}
                >
                  {importMut.isPending ? 'Importando y subiendo…' : `Importar ${rows.length} producto(s)`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRows([]);
                    setImages([]);
                    setWarnings([]);
                    setUnknown([]);
                  }}
                >
                  Limpiar todo
                </Button>
              </div>

              {importMut.data?.importData && importMut.data.importData.errors.length > 0 && (
                <div className="text-xs">
                  <div className="font-semibold mb-1">Errores por item:</div>
                  {importMut.data.importData.errors.map((e, i) => (
                    <div key={i} className="text-destructive">
                      Fila {e.row} (PLU {e.plu}): {e.error}
                    </div>
                  ))}
                </div>
              )}
              {importMut.data?.importData.grouping.errors.length ? (
                <div className="text-xs">
                  <div className="font-semibold mb-1">Errores de agrupación:</div>
                  {importMut.data.importData.grouping.errors.slice(0, 20).map((e, i) => (
                    <div key={i} className="text-destructive">
                      Departamento {e.department}
                      {e.plu ? ` · PLU ${e.plu}` : e.pluCount ? ` · ${e.pluCount} PLU(s)` : ''}: {e.error}
                    </div>
                  ))}
                  {importMut.data.importData.grouping.errors.length > 20 && (
                    <div className="text-muted-foreground">
                      … y {importMut.data.importData.grouping.errors.length - 20} error(es) más
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      <Card className="bg-muted/30">
        <CardContent className="flex items-start gap-3 py-4">
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="text-xs text-muted-foreground">
            Los productos y sus imágenes quedan persistidos en el backend BLS y en el portal SDM. Puedes sincronizarlos a las balanzas en cualquier momento usando el bloque superior de <strong>Envío directo</strong>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
