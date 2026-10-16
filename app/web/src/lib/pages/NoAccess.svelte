<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
  import { app } from '$lib/store.svelte';
</script>

<div class="mx-auto max-w-md px-4 py-24">
  <Card.Root>
    <Card.Header>
      <Card.Title>You haven't been added to a workspace yet</Card.Title>
      <Card.Description>
        You're signed in as <span class="text-foreground font-medium">{app.me?.email}</span>. Ask a workspace owner to add this email, then reload
        this page.
      </Card.Description>
    </Card.Header>
    <Card.Footer class="gap-2">
      <Button onclick={() => location.reload()}>Reload</Button>
      <Button variant="ghost" href="/cdn-cgi/access/logout">Use a different email</Button>
    </Card.Footer>
  </Card.Root>
</div>
