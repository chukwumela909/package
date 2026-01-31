import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Force Node.js runtime for better compatibility with Mux SDK
export const runtime = 'nodejs';

// POST /api/streams - Create a new stream
export async function POST(request: NextRequest) {
  try {
    // Check Mux credentials
    if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
      console.error('Mux credentials not configured');
      return NextResponse.json(
        { error: 'Streaming service not configured. Please check MUX_TOKEN_ID and MUX_TOKEN_SECRET in .env.local' },
        { status: 500 }
      );
    }

    // Dynamic import of Mux to avoid edge runtime issues
    const Mux = (await import('@mux/mux-node')).default;
    const mux = new Mux({
      tokenId: process.env.MUX_TOKEN_ID,
      tokenSecret: process.env.MUX_TOKEN_SECRET,
    });

    const supabase = await createClient();
    
    // Check if user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in to create a stream.' },
        { status: 401 }
      );
    }

    // Parse request body
    const { title, category } = await request.json();

    if (!title || !title.trim()) {
      return NextResponse.json(
        { error: 'Stream title is required' },
        { status: 400 }
      );
    }

    // Check if user already has an active stream
    const { data: existingStream } = await supabase
      .from('streams')
      .select('id')
      .eq('user_id', user.id)
      .in('status', ['idle', 'active'])
      .single();

    if (existingStream) {
      return NextResponse.json(
        { error: 'You already have an active stream. Please end it before starting a new one.' },
        { status: 400 }
      );
    }

    // Create Mux live stream
    let muxStream;
    try {
      muxStream = await mux.video.liveStreams.create({
        playback_policy: ['public'],
        new_asset_settings: {
          playback_policy: ['public'],
        },
        reconnect_window: 60, // Allow reconnection within 60 seconds
        latency_mode: 'low', // Low latency for trading streams
      });
    } catch (muxError: unknown) {
      console.error('Mux API error:', muxError);
      const errorMessage = muxError instanceof Error ? muxError.message : 'Unknown Mux error';
      return NextResponse.json(
        { error: `Failed to create stream with Mux: ${errorMessage}. Please check your Mux API credentials.` },
        { status: 500 }
      );
    }

    // Get playback ID
    const playbackId = muxStream.playback_ids?.[0]?.id || '';

    // Save stream to Supabase
    const { data: stream, error: insertError } = await supabase
      .from('streams')
      .insert({
        user_id: user.id,
        title: title.trim(),
        category: category || 'trading',
        mux_stream_id: muxStream.id,
        mux_playback_id: playbackId,
        stream_key: muxStream.stream_key,
        status: 'idle',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating stream in database:', insertError);
      // Try to clean up Mux stream if database insert fails
      try {
        await mux.video.liveStreams.delete(muxStream.id);
      } catch (e) {
        console.error('Failed to clean up Mux stream:', e);
      }
      return NextResponse.json(
        { error: `Failed to save stream to database: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      stream,
      rtmpUrl: 'rtmps://global-live.mux.com:443/app',
      rtmpIngestUrl: `rtmps://global-live.mux.com:443/app/${muxStream.stream_key}`,
      streamKey: muxStream.stream_key,
    });

  } catch (error: unknown) {
    console.error('Error creating stream:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Internal server error: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// GET /api/streams - Get all active streams
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const category = searchParams.get('category');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');

    let query = supabase
      .from('streams')
      .select('*', { count: 'exact' })
      .eq('is_deleted', false)
      .order('viewer_count', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by status
    if (status === 'active') {
      query = query.eq('status', 'active');
    } else if (status === 'all') {
      query = query.in('status', ['active', 'idle']);
    }

    // Filter by category
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    const { data: streams, error, count } = await query;

    if (error) {
      console.error('Error fetching streams:', error);
      // If table doesn't exist yet, return empty array
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json({
          streams: [],
          total: 0,
          warning: 'Streams table not set up yet. Please run the database migration.',
        });
      }
      return NextResponse.json(
        { error: 'Failed to fetch streams' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      streams: streams || [],
      total: count || 0,
    });

  } catch (error) {
    console.error('Error fetching streams:', error);
    // Return empty array for any error to prevent UI from breaking
    return NextResponse.json({
      streams: [],
      total: 0,
    });
  }
}
