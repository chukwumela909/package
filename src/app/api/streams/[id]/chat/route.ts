import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Force Node.js runtime for better compatibility
export const runtime = 'nodejs';

// GET /api/streams/[id]/chat - Get chat messages for a stream
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const limit = parseInt(searchParams.get('limit') || '50');
    const before = searchParams.get('before'); // For pagination (get messages before this timestamp)

    let query = supabase
      .from('stream_chat_messages')
      .select('*')
      .eq('stream_id', id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Error fetching chat messages:', error);
      return NextResponse.json(
        { error: 'Failed to fetch messages' },
        { status: 500 }
      );
    }

    // Reverse to show oldest first (for display)
    return NextResponse.json({
      messages: (messages || []).reverse(),
    });

  } catch (error) {
    console.error('Error fetching chat:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/streams/[id]/chat - Send a chat message
export async function POST(
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
        { error: 'Please log in to send messages' },
        { status: 401 }
      );
    }

    const { message } = await request.json();

    if (!message || !message.trim()) {
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    // Validate message length
    if (message.length > 500) {
      return NextResponse.json(
        { error: 'Message is too long (max 500 characters)' },
        { status: 400 }
      );
    }

    // Check if stream exists and is active
    const { data: stream, error: streamError } = await supabase
      .from('streams')
      .select('id, status')
      .eq('id', id)
      .single();

    if (streamError || !stream) {
      return NextResponse.json(
        { error: 'Stream not found' },
        { status: 404 }
      );
    }

    if (stream.status === 'ended') {
      return NextResponse.json(
        { error: 'Cannot send messages to an ended stream' },
        { status: 400 }
      );
    }

    // Get user display name
    const userName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous';
    const userAvatar = user.user_metadata?.avatar_url || null;

    // Insert the message
    const { data: chatMessage, error: insertError } = await supabase
      .from('stream_chat_messages')
      .insert({
        stream_id: id,
        user_id: user.id,
        message: message.trim(),
        user_name: userName,
        user_avatar: userAvatar,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting chat message:', insertError);
      return NextResponse.json(
        { error: 'Failed to send message' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: chatMessage });

  } catch (error) {
    console.error('Error sending chat message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/streams/[id]/chat?messageId=xxx - Delete a chat message (for stream owner)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const messageId = searchParams.get('messageId');

    if (!messageId) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      );
    }

    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the message and stream to verify permissions
    const { data: message } = await supabase
      .from('stream_chat_messages')
      .select('*, stream:streams!inner(user_id)')
      .eq('id', messageId)
      .eq('stream_id', id)
      .single();

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      );
    }

    // Check if user is the message author or stream owner
    const isOwner = message.user_id === user.id;
    const isStreamOwner = (message.stream as { user_id: string })?.user_id === user.id;

    if (!isOwner && !isStreamOwner) {
      return NextResponse.json(
        { error: 'You can only delete your own messages or messages in your stream' },
        { status: 403 }
      );
    }

    // Soft delete the message
    const { error: deleteError } = await supabase
      .from('stream_chat_messages')
      .update({
        is_deleted: true,
        deleted_by: user.id,
      })
      .eq('id', messageId);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete message' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting chat message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
