import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Force Node.js runtime for better compatibility
export const runtime = 'nodejs';

// GET /api/streams/[id] - Get stream details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: stream, error } = await supabase
      .from('streams')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single();

    if (error || !stream) {
      return NextResponse.json(
        { error: 'Stream not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ stream });

  } catch (error) {
    console.error('Error fetching stream:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/streams/[id] - Update stream (end stream, update title, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the stream
    const { data: stream, error: fetchError } = await supabase
      .from('streams')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !stream) {
      return NextResponse.json(
        { error: 'Stream not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (stream.user_id !== user.id) {
      return NextResponse.json(
        { error: 'You can only modify your own streams' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, title, category } = body;

    // Handle ending a stream
    if (action === 'end') {
      // Delete the Mux stream to stop any active streaming
      if (stream.mux_stream_id && process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET) {
        try {
          const Mux = (await import('@mux/mux-node')).default;
          const mux = new Mux({
            tokenId: process.env.MUX_TOKEN_ID,
            tokenSecret: process.env.MUX_TOKEN_SECRET,
          });
          await mux.video.liveStreams.delete(stream.mux_stream_id);
        } catch (e) {
          console.error('Error deleting Mux stream:', e);
        }
      }

      // Update stream status in database
      const { data: updatedStream, error: updateError } = await supabase
        .from('streams')
        .update({
          status: 'ended',
          ended_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json(
          { error: 'Failed to end stream' },
          { status: 500 }
        );
      }

      return NextResponse.json({ stream: updatedStream });
    }

    // Handle updating stream details
    const updates: Record<string, string> = {};
    if (title) updates.title = title.trim();
    if (category) updates.category = category;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid updates provided' },
        { status: 400 }
      );
    }

    const { data: updatedStream, error: updateError } = await supabase
      .from('streams')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update stream' },
        { status: 500 }
      );
    }

    return NextResponse.json({ stream: updatedStream });

  } catch (error) {
    console.error('Error updating stream:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/streams/[id] - Soft delete a stream
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the stream
    const { data: stream } = await supabase
      .from('streams')
      .select('*')
      .eq('id', id)
      .single();

    if (!stream) {
      return NextResponse.json(
        { error: 'Stream not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (stream.user_id !== user.id) {
      return NextResponse.json(
        { error: 'You can only delete your own streams' },
        { status: 403 }
      );
    }

    // End the Mux stream if active
    if (stream.mux_stream_id && stream.status !== 'ended' && process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET) {
      try {
        const Mux = (await import('@mux/mux-node')).default;
        const mux = new Mux({
          tokenId: process.env.MUX_TOKEN_ID,
          tokenSecret: process.env.MUX_TOKEN_SECRET,
        });
        await mux.video.liveStreams.delete(stream.mux_stream_id);
      } catch (e) {
        console.error('Error deleting Mux stream:', e);
      }
    }

    // Soft delete the stream
    const { error: deleteError } = await supabase
      .from('streams')
      .update({
        is_deleted: true,
        status: 'ended',
        ended_at: stream.ended_at || new Date().toISOString(),
      })
      .eq('id', id);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete stream' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting stream:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
