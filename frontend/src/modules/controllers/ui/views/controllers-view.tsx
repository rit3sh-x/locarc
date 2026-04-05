import { Suspense, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ControllerFilters } from '../components/controller-filters'
import { ControllerList, ControllerListSkeleton } from '../components/controller-list'
import {
    AddControllerModal,
    EditControllerModal,
    ViewControllerModal,
} from '../components/controller-forms'
import type {
    AddControllerFormValues,
    EditControllerFormValues,
} from '../components/controller-forms'
import {
    useAddController,
    useModifyController,
    useRemoveController,
} from '../../hooks/use-controllers'
import type { Controller } from '../../types'

export const ControllerView = (): React.JSX.Element => {
    const [selectedController, setSelectedController] = useState<Controller | null>(null)
    const [viewModalOpen, setViewModalOpen] = useState(false)
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [addModalOpen, setAddModalOpen] = useState(false)
    const [addPrefill, setAddPrefill] = useState<Partial<AddControllerFormValues> | null>(null)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

    const { addController, isPending: isAdding } = useAddController()
    const { modifyController, isPending: isModifying } = useModifyController()
    const { removeController, isPending: isDeleting } = useRemoveController()

    const handleView = (controller: Controller) => {
        setSelectedController(controller)
        setViewModalOpen(true)
    }

    const handleEdit = (controller: Controller) => {
        setSelectedController(controller)
        setEditModalOpen(true)
    }

    const handleDelete = (controller: Controller) => {
        setSelectedController(controller)
        setDeleteDialogOpen(true)
    }

    const handleDuplicate = (controller: Controller) => {
        setAddPrefill({
            name: '',
            username: '',
            password: '',
            settings: {
                minFreqHz: controller.settings.minFreqHz,
                maxFreqHz: controller.settings.maxFreqHz,
                sampleRate: controller.settings.sampleRate,
                vgaGain: controller.settings.vgaGain,
                lnaGain: controller.settings.lnaGain,
                bufferSize: controller.settings.bufferSize,
            },
        })
        setAddModalOpen(true)
    }

    const handleAddSubmit = async (data: AddControllerFormValues) => {
        await addController(data)
        setAddModalOpen(false)
        setAddPrefill(null)
    }

    const handleEditSubmit = async (data: EditControllerFormValues) => {
        if (!selectedController) return
        await modifyController({
            controllerId: selectedController.id,
            ...data,
        })
        setEditModalOpen(false)
        setSelectedController(null)
    }

    const handleDeleteConfirm = async () => {
        if (!selectedController) return
        await removeController({ controllerId: selectedController.id })
        setDeleteDialogOpen(false)
        setSelectedController(null)
    }

    return (
        <>
            <div className="w-full px-4 lg:px-12 py-8 flex flex-col gap-4 h-full overflow-hidden">
                <div className="grid grid-cols-1 lg:grid-cols-6 xl:grid-cols-8 gap-y-6 gap-x-12 h-full">
                    <div className="lg:col-span-2 xl:col-span-2">
                        <div className="sticky top-0 space-y-4">
                            <Button
                                onClick={() => {
                                    setAddPrefill(null)
                                    setAddModalOpen(true)
                                }}
                                className="w-full"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Controller
                            </Button>
                            <ControllerFilters />
                        </div>
                    </div>

                    <div className="lg:col-span-4 xl:col-span-6">
                        <Suspense fallback={<ControllerListSkeleton />}>
                            <ControllerList
                                onView={handleView}
                                onEdit={handleEdit}
                                onDuplicate={handleDuplicate}
                                onDelete={handleDelete}
                            />
                        </Suspense>
                    </div>
                </div>
            </div>

            {selectedController && (
                <>
                    <ViewControllerModal
                        open={viewModalOpen}
                        onOpenChange={setViewModalOpen}
                        controller={selectedController}
                    />
                    <EditControllerModal
                        open={editModalOpen}
                        onOpenChange={setEditModalOpen}
                        controller={selectedController}
                        onSubmit={handleEditSubmit}
                        isPending={isModifying}
                    />
                </>
            )}

            <AddControllerModal
                open={addModalOpen}
                onOpenChange={setAddModalOpen}
                onSubmit={handleAddSubmit}
                isPending={isAdding}
                initialValues={addPrefill ?? undefined}
            />

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Controller</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete &quot;
                            {selectedController?.name}&quot;? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteConfirm}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
