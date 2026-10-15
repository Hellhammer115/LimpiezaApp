-- Permanent category deletion (admin). products.category_id is NOT NULL and
-- order_items reference products, so a category's products can be neither
-- orphaned nor deleted with it: they're moved to another category first,
-- in the same transaction as the delete. Deactivating (is_active = false)
-- remains the reversible way to hide a category.
--
-- Called only by the admin-categories Edge Function (service role) after its
-- admin check. Returns how many products were moved.
create or replace function public.delete_category(
  p_category_id uuid,
  p_move_to     uuid,
  p_actor       uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Lock the row so a concurrent edit/delete of the same category waits.
  perform 1 from public.categories where id = p_category_id for update;
  if not found then
    raise exception 'La categoría ya no existe' using errcode = 'P0002';
  end if;

  select count(*) into v_count from public.products where category_id = p_category_id;

  if v_count > 0 then
    if p_move_to is null then
      raise exception 'La categoría tiene % productos; elige a qué categoría moverlos', v_count
        using errcode = 'P0001';
    end if;
    if p_move_to = p_category_id then
      raise exception 'Elige una categoría distinta para los productos' using errcode = 'P0001';
    end if;
    perform 1 from public.categories where id = p_move_to;
    if not found then
      raise exception 'La categoría destino ya no existe' using errcode = 'P0002';
    end if;

    update public.products
       set category_id = p_move_to,
           updated_by  = p_actor,
           updated_at  = now()
     where category_id = p_category_id;
  end if;

  delete from public.categories where id = p_category_id;
  return v_count;
end;
$$;

revoke execute on function public.delete_category(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_category(uuid, uuid, uuid)
  to service_role;
