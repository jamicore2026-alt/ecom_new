<script lang="ts">
	let { name, fill = false, size = 'text-[18px]', class: className = '' } = $props<{
		name: string
		fill?: boolean
		size?: string
		class?: string
	}>()
</script>

<span
	class="material-symbols-outlined inline-flex select-none {fill ? 'fill' : ''} {size} {className}"
	aria-hidden="true"
>{name}</span
>