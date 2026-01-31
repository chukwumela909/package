"use client";

import React, { useContext, useState, useEffect } from "react";
import Image from "next/image";
import { CustomizerContext } from "@/app/context/customizerContext";
import { createClient } from "@/lib/supabase/client";

const Profile = () => {

  const { isDrawerOpen, setIsDrawerOpen } = useContext(CustomizerContext);
  const toggleDrawer = () => setIsDrawerOpen(!isDrawerOpen);

  const [userName, setUserName] = useState<string>('');

  useEffect(() => {
    const fetchUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserName(user.user_metadata?.full_name || user.email?.split('@')[0] || 'User');
      }
    };
    fetchUser();
  }, []);

  return (
    <div className="relative z-3">
      {/* Trigger Button to open the drawer */}
      <div
        onClick={toggleDrawer}
        className="hover:text-primary rounded-md p-1 flex group justify-center items-center gap-2 cursor-pointer"
      >
        <Image
          src="/images/profile/user-1.jpg"
          alt="logo"
          height="35"
          width="35"
          className="rounded-full"
        />
        <div className="">
          <h5 className="text-black dark:text-white text-sm group-hover:text-primary">{userName || 'Loading...'}</h5>
          <p className="text-black opacity-60 dark:text-white dark:opacity-40 text-xs">
            Trader
          </p>
        </div>
      </div>
    </div>
  );
};

export default Profile;
